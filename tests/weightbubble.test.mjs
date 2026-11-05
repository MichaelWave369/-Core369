import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACE_SCHEMA, validateWorkload, replayWorkload, comparePolicies, validateReplayOptions} from '../src/weightbubble.js';
import {makeWorkload, WORKLOAD_IDS} from '../src/workloads.js';
import {parseReplayArgs, runReplay} from '../scripts/weightbubble-replay.mjs';

function trace(ids, modelData = [
  {id:'a',sizeGiB:1,loadMs:5000,inferMs:50},
  {id:'b',sizeGiB:1,loadMs:10,inferMs:50},
  {id:'c',sizeGiB:1,loadMs:10,inferMs:50}
]) {
  return {schema:TRACE_SCHEMA,name:'test trace',models:modelData,
    requests:ids.map((model,i)=>({atMs:i*1000,model}))};
}

test('built-in workloads are valid, synthetic and ordered',()=>{
  for(const id of WORKLOAD_IDS){
    const w=makeWorkload(id);
    assert.equal(validateWorkload(w),w);
    assert.ok(w.requests.length>=30);
    assert.match(w.description,/Synthetic/);
  }
});

test('no-cache policy never retains a model',()=>{
  const r=replayWorkload(trace(['a','a','a']), 'none', {budgetGiB:2});
  assert.equal(r.stats.hits,0);
  assert.equal(r.stats.misses,3);
  assert.equal(r.stats.evictions,0);
  assert.equal(r.stats.estimatedLoadMs,15000);
  assert.ok(r.events.every(e=>e.usedGiB===0&&e.action==='no-cache'));
});

test('LRU uses strictly prior recency for victim selection',()=>{
  const r=replayWorkload(trace(['a','b','a','c','b']),'lru',{budgetGiB:2});
  assert.deepEqual(r.events.map(e=>e.action),['loaded','loaded','hit','loaded','loaded']);
  assert.deepEqual(r.events[3].changes,[{id:'b',reason:'capacity'}]);
  assert.deepEqual(r.events[4].changes,[{id:'a',reason:'capacity'}]);
  assert.equal(r.stats.hits,1);
  assert.equal(r.stats.evictions,2);
});

test('Φ policy can protect costly, repeatedly accessed weights',()=>{
  const w=trace(['a','b','a','c','b','a','c','b','a']);
  const res=comparePolicies(w,{budgetGiB:2,halfLifeMs:30000});
  assert.ok(res.runs.phi.stats.estimatedLoadMs<res.runs.lru.stats.estimatedLoadMs);
  assert.equal(res.phiVsLru.winner,'phi');
});

test('Φ can lose to LRU when history stops predicting future',()=>{
  const w=trace(['a','b','a','c','b','c','b','c','b','c']);
  const res=comparePolicies(w,{budgetGiB:2,halfLifeMs:100000});
  assert.ok(res.runs.phi.stats.estimatedLoadMs>res.runs.lru.stats.estimatedLoadMs);
  assert.equal(res.phiVsLru.winner,'lru');
});

test('policies never violate the resident weight capacity',()=>{
  for(const policy of ['none','lru','phi']){
    for(const budgetGiB of [2,4,7,12,20]){
      const r=replayWorkload(makeWorkload('bursts'),policy,{budgetGiB});
      assert.ok(r.events.every(e=>e.usedGiB<=budgetGiB+1e-7));
      assert.ok(r.stats.peakResidentGiB<=budgetGiB+1e-7);
      assert.equal(r.stats.hits+r.stats.misses,r.stats.requests);
      assert.ok(r.stats.estimatedLoadMs>=0);
    }
  }
});

test('oversized model bypass does not evict existing residents',()=>{
  const w=trace(['a','c','b','a'],[
    {id:'a',sizeGiB:1,loadMs:10,inferMs:20},
    {id:'b',sizeGiB:4,loadMs:10,inferMs:20},
    {id:'c',sizeGiB:1,loadMs:10,inferMs:20}
  ]);
  const r=replayWorkload(w,'phi',{budgetGiB:2});
  assert.equal(r.events[2].action,'oversize-bypass');
  assert.deepEqual(r.events[2].resident,['a','c']);
  assert.equal(r.stats.oversize,1);
  assert.equal(r.events[3].action,'hit');
});

test('TTL expires at request boundaries and zero disables it',()=>{
  const w={...trace(['a','a']),requests:[{atMs:0,model:'a'},{atMs:11000,model:'a'}]};
  const ttl=replayWorkload(w,'lru',{budgetGiB:2,ttlMs:10000});
  const noTtl=replayWorkload(w,'lru',{budgetGiB:2,ttlMs:0});
  assert.equal(ttl.stats.expired,1);
  assert.equal(ttl.stats.hits,0);
  assert.equal(noTtl.stats.hits,1);
});

test('no future request can affect earlier replay actions',()=>{
  const a=trace(['a','b','a','c','b','c','a']);
  const b=trace(['a','b','a','c','a','a','a']);
  const prefixSize=4;
  const ra=replayWorkload(a,'phi',{budgetGiB:2});
  const rb=replayWorkload(b,'phi',{budgetGiB:2});
  assert.deepEqual(ra.events.slice(0,prefixSize),rb.events.slice(0,prefixSize));
});

test('rejects maliciously large, unsorted or malformed workload',()=>{
  const base=trace(['a','b']);
  const malformed=structuredClone(base);malformed.requests[1].atMs=-2;
  assert.throws(()=>validateWorkload(malformed),/timestamp/);
  const unsorted=structuredClone(base);unsorted.requests[1].atMs=0;unsorted.requests[0].atMs=1;
  assert.throws(()=>validateWorkload(unsorted),/nondecreasing/);
  const unknown=structuredClone(base);unknown.requests[0].model='other';
  assert.throws(()=>validateWorkload(unknown),/unknown model/);
  const duplicate=structuredClone(base);duplicate.models.push({...duplicate.models[0]});
  assert.throws(()=>validateWorkload(duplicate),/duplicate/);
  const nan=structuredClone(base);nan.models[0].sizeGiB=NaN;
  assert.throws(()=>validateWorkload(nan),/sizeGiB/);
  const enormous=structuredClone(base);enormous.requests=Array.from({length:5001},(_,i)=>({atMs:i,model:'a'}));
  assert.throws(()=>validateWorkload(enormous),/requests length/);
  assert.throws(()=>validateWorkload({...base,schema:'other'}),/schema/);
});

test('options fail closed on non-finite or negative settings',()=>{
  assert.throws(()=>validateReplayOptions({budgetGiB:Infinity}),/budgetGiB/);
  assert.throws(()=>validateReplayOptions({ttlMs:-1}),/ttlMs/);
  assert.throws(()=>validateReplayOptions({halfLifeMs:500}),/halfLifeMs/);
  assert.throws(()=>replayWorkload(trace(['a']),'unknown'),/policy/);
});

test('CLI defaults are deterministic and do not contact Ollama',async()=>{
  const cfg=parseReplayArgs([]);
  assert.equal(cfg.budgetGiB,12);
  const one=await runReplay(cfg);
  const two=await runReplay(cfg);
  assert.deepEqual(one,two);
  assert.equal(one.runs.phi.stats.requests,72);
  assert.equal(one.runs.lru.stats.requests,72);
});

test('CLI accepts local trace content and rejects invalid settings',async()=>{
  const input=trace(['a','b','c']);
  const opts=parseReplayArgs(['--trace','virtual.json','--budget-gib','1.5','--ttl-ms','10000']);
  const result=await runReplay(opts,{readFile:async()=>JSON.stringify(input)});
  assert.equal(result.runs.lru.stats.requests,3);
  assert.equal(result.options.budgetGiB,1.5);
  assert.throws(()=>parseReplayArgs(['--budget-gib','0']),/budgetGiB/);
  assert.throws(()=>parseReplayArgs(['--preset','invalid']),/preset/);
  assert.throws(()=>parseReplayArgs(['--wrong','thing']),/argument/);
});
