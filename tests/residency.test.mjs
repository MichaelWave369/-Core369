import test from 'node:test';
import assert from 'node:assert/strict';
import { RESIDENCY_SCHEMA, validateResidencyReport, summarizeResidency } from '../src/residency.js';
import { parseResidencyArgs, collectResidency, conditionOrders } from '../scripts/residency-bench.mjs';

const makeConfig = (args = []) => parseResidencyArgs(['--model','qwen3:4b','--pairs','5','--execute',...args]);
const digest = 'c'.repeat(64);
function makeDeps({ loadedAtStart = [], failCold = false } = {}) {
  let loaded = loadedAtStart.includes('qwen3:4b');
  const actions = [];
  const getJson = async url => {
    if (url.endsWith('/api/ps')) return {
      models: loaded ? [{name:'qwen3:4b',size_vram:4294967296,digest}] : loadedAtStart.filter(x=>x!=='qwen3:4b').map(name=>({name,digest:'d'.repeat(64)}))
    };
    if (url.endsWith('/api/version')) return {version:'mock-0.1'};
    if (url.endsWith('/api/tags')) return {models:[{name:'qwen3:4b',digest,size:6e9}]};
    throw Error('unknown GET ' + url);
  };
  let currentCondition = null;
  const postJson = async (_url, body) => {
    if (body.prompt !== '') throw Error('unexpected nonempty control prompt');
    if (body.keep_alive === 0) { loaded = false; actions.push('unload'); }
    else if (body.keep_alive === '10m') { loaded = true; actions.push('preload'); }
    else throw Error('unknown keep_alive');
    return {done:true};
  };
  const generate = async (_url, body) => {
    currentCondition = body.keep_alive === '10m' ? 'preloaded' : 'cold';
    actions.push('generate:'+currentCondition);
    if (failCold && currentCondition === 'cold') throw Error('simulated model timeout');
    return {
      totalSeconds: currentCondition === 'cold' ? 2.3 : 1.3,
      loadSeconds: currentCondition === 'cold' ? .9 : .01,
      decodeTokensPerSec: 33,
      generatedTokens: 40,
      clientTtftMs: currentCondition === 'cold' ? 1250 : 260
    };
  };
  let tick=0;
  return {
    getJson, postJson, generate, log:()=>{},
    deviceInfo:()=>({os:'Test OS',cpu:'Test CPU',gpu:null}),
    now:()=>{tick+=44;return tick;},
    actions, get loaded(){return loaded;}
  };
}

test('CLI defaults to read-only and validates loopback and pairs', () => {
  const preview = parseResidencyArgs(['--model','qwen3:4b']);
  assert.equal(preview.execute,false);
  assert.equal(preview.pairs,6);
  assert.equal(parseResidencyArgs(['--help']).help,true);
  assert.throws(()=>parseResidencyArgs(['--model','qwen3:4b','--pairs','3']),/pairs/);
  assert.throws(()=>parseResidencyArgs(['--model','qwen3:4b','--url','https://example.com']),/localhost/);
});

test('condition order is deterministically seeded and paired', () => {
  const first = conditionOrders(25,369);
  assert.deepEqual(first,conditionOrders(25,369));
  assert.notDeepEqual(first,conditionOrders(25,371));
  for(const row of first)assert.deepEqual(new Set(row),new Set(['cold','preloaded']));
});

test('cannot change model residency without explicit execution', async () => {
  const deps = makeDeps();
  await assert.rejects(()=>collectResidency(parseResidencyArgs(['--model','qwen3:4b']),deps),/execute/);
  assert.equal(deps.actions.length,0);
});

test('blocks busy Ollama state unless operator explicitly allows it', async () => {
  const deps = makeDeps({loadedAtStart:['qwen3:4b']});
  await assert.rejects(()=>collectResidency(makeConfig(),deps),/busy Ollama/);
  assert.equal(deps.actions.length,0);
});

test('crossover controls named residency, records paired metrics and cleans up', async () => {
  const deps=makeDeps();
  const result=await collectResidency(makeConfig(),deps);
  validateResidencyReport(result);
  assert.equal(result.schema,RESIDENCY_SCHEMA);
  assert.equal(result.trials.length,10);
  assert.equal(result.manifest.initialLoadedModels,0);
  assert.ok(!deps.loaded);
  assert.equal(deps.actions.filter(x=>x==='preload').length,5);
  assert.equal(deps.actions.filter(x=>x==='generate:cold').length,5);
  assert.equal(deps.actions.filter(x=>x==='generate:preloaded').length,5);
  assert.ok(!JSON.stringify(result).includes('Explain in plain English'));
  assert.ok(result.trials.filter(t=>t.condition==='preloaded').every(t=>t.residentBeforeGeneration&&t.preloadMs>0&&t.sizeVramBytes===4294967296));
  const stats=summarizeResidency(result);
  assert.equal(stats.pairedCount,5);
  assert.equal(stats.ttftSavedMedianMs,990);
  assert.equal(stats.enoughPairs,true);
  assert.equal(stats.preloaded.preloadMedianMs,44);
  assert.ok(stats.preloaded.totalIncludingPreloadMedianSec>stats.preloaded.engineLatencyMedianSec);
});

test('failed run remains visible and blocks complete-pair flag',async()=>{
  const report=await collectResidency(makeConfig(),makeDeps({failCold:true}));
  const s=summarizeResidency(report);
  assert.equal(s.pairedCount,0);
  assert.equal(s.enoughPairs,false);
  assert.equal(s.cold.failures,5);
});

test('invalid imported reports fail closed',async()=>{
  const valid=await collectResidency(makeConfig(),makeDeps());
  const clone=()=>structuredClone(valid);
  const wrong=clone(); wrong.schema='other';assert.throws(()=>validateResidencyReport(wrong),/schema/);
  const duplicate=clone();duplicate.trials[1].condition=duplicate.trials[0].condition;
  assert.throws(()=>validateResidencyReport(duplicate),/duplicate/);
  const fake=clone();fake.trials[0].clientTtftMs=Infinity;
  assert.throws(()=>validateResidencyReport(fake),/clientTtftMs/);
});

test('allow-loaded mode never explicitly unloads other models',async()=>{
  const deps=makeDeps({loadedAtStart:['other:7b']});
  const r=await collectResidency(makeConfig(['--allow-loaded']),deps);
  assert.equal(r.manifest.initialLoadedModels,1);
  assert.equal(r.trials.length,10);
  assert.ok(deps.actions.every(x=>['unload','preload','generate:cold','generate:preloaded'].includes(x)));
});
