import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateResidencyReports,calibrationSummary,validateArrivals,ARRIVALS_SCHEMA} from '../src/calibration.js';
import {parseCalibrationArgs,runCalibration} from '../scripts/calibrate-residency.mjs';
import {parseObserveArgs,observe,OBSERVE_SCHEMA} from '../scripts/ollama-observe.mjs';
import {comparePolicies} from '../src/weightbubble.js';

const digests=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)];
const hashes=digests;
const hardware={os:'Mock Windows',cpu:'Mock Core Ultra 9',ramGiB:32,gpu:{name:'Mock RTX',totalMiB:12288,driver:'mock'}};
function report(name,digest,loadMs=900,vrBytes=4*1024**3){
  return {
    schema:'phicore369.residency.v1',source:'measured-ollama-residency-local',
    manifest:{
      experimentId:name+'-run',utc:'2026-11-04T00:00:00Z',backend:'ollama',backendVersion:'test',
      model:name,modelDigest:digest,modelSizeBytes:vrBytes*.75,hardware,
      options:{num_ctx:4096,num_predict:96,temperature:0,seed:369},
      pairs:5,promptHashes:hashes,initialLoadedModels:0,initiallyResident:false
    },
    trials:Array.from({length:5},(_,i)=>['cold','preloaded'].map(condition=>({
      pair:i+1,condition,promptId:['explain','reason','code'][i%3],
      promptSha256:hashes[i%3],
      ok:true,totalSeconds:(loadMs+160)/1000,
      loadSeconds:condition==='cold'?loadMs/1000:0.01,
      decodeTokensPerSec:40,generatedTokens:32,
      clientTtftMs:condition==='cold'?loadMs+40:180,
      preloadMs:condition==='cold'?0:loadMs,
      residentBeforeGeneration:condition==='preloaded',
      sizeVramBytes:condition==='cold'?null:vrBytes
    }))).flat()
  };
}
const arrivals=(models=['qwen3:4b','gemma3:12b'])=>({
  schema:ARRIVALS_SCHEMA,name:'measured-profile sequence',
  requests:[
    {atMs:0,model:models[0]},
    {atMs:1000,model:models[1]},
    {atMs:2000,model:models[0]},
    {atMs:4000,model:models[1]},
    {atMs:7000,model:models[0]}
  ]
});
const getReports=()=>[report('qwen3:4b',digests[0],800,4*1024**3),report('gemma3:12b',digests[1],1800,8*1024**3)];

test('two isolated R2B reports calibrate distinct model profiles and replay without live API',()=>{
  const input=arrivals();
  const value=calibrateResidencyReports(input,getReports());
  assert.equal(value.schema,'phicore369.calibration.v1');
  assert.equal(value.trace.models.length,2);
  assert.equal(value.trace.requests.length,5);
  assert.equal(value.trace.models[0].loadMs,800);
  assert.equal(value.trace.models[1].sizeGiB,8);
  assert.equal(value.trace.models[0].inferMs,160);
  assert.equal(value.manifest.sourceReports[0].pairs,5);
  assert.equal(calibrationSummary(value).sources,2);
  assert.equal(comparePolicies(value.trace,{budgetGiB:12}).runs.lru.stats.hits,3);
});

test('all supplied arrival models need a measured report and ordered timestamps',()=>{
  const a=arrivals();
  a.requests[0].model='unknown';
  assert.throws(()=>calibrateResidencyReports(a,getReports()),/No calibrated R2B report/);
  const b=arrivals();
  b.requests[2].atMs=500;
  assert.throws(()=>validateArrivals(b),/timestamp/);
  assert.throws(()=>validateArrivals({...arrivals(),schema:'unknown'}),/schema/);
});

test('calibration rejects conflicting machine settings or repeated model identity',()=>{
  const rs=getReports();
  rs[1].manifest.options.num_ctx=8192;
  assert.throws(()=>calibrateResidencyReports(arrivals(),rs),/settings mismatch/);
  const dup=getReports();
  dup[1].manifest.model=dup[0].manifest.model;
  assert.throws(()=>calibrateResidencyReports(arrivals(),dup),/Duplicate report/);
  const wrongHost=getReports();
  wrongHost[1].manifest.hardware.cpu='Different';
  assert.throws(()=>calibrateResidencyReports(arrivals(),wrongHost),/Hardware mismatch/);
  const badVersion=getReports();
  badVersion[1].manifest.backendVersion='changed';
  assert.throws(()=>calibrateResidencyReports(arrivals(),badVersion),/version mismatch/);
});

test('calibration rejects incomplete trials, pre-existing residency and unknown GPU memory',()=>{
  const reportCopies=getReports();
  reportCopies[0].trials[0].ok=false;
  reportCopies[0].trials[0].error='failed';
  assert.throws(()=>calibrateResidencyReports(arrivals(),reportCopies),/Not enough successful/);
  const busy=getReports();
  busy[0].manifest.initialLoadedModels=2;
  assert.throws(()=>calibrateResidencyReports(arrivals(),busy),/isolated/);
  const noVram=getReports();
  for(const trial of noVram[1].trials)if(trial.condition==='preloaded')trial.sizeVramBytes=0;
  assert.throws(()=>calibrateResidencyReports(arrivals(),noVram),/GPU VRAM/);
});

test('CLI deterministic offline conversion uses user-supplied files only',async()=>{
  const cfg=parseCalibrationArgs([
    '--arrivals','arrivals.json','--report','modelA.json','--report','modelB.json','--budget-gib','12'
  ]);
  const reports=getReports();
  const a=arrivals();
  const deps={readFile:async path=>path.endsWith('arrivals.json')?JSON.stringify(a)
    :path.endsWith('modelA.json')?JSON.stringify(reports[0]):JSON.stringify(reports[1])};
  const x=await runCalibration(cfg,deps);
  const y=await runCalibration(cfg,deps);
  assert.deepEqual(x,y);
  assert.equal(x.replay.runs.phi.stats.requests,5);
  assert.equal(x.trace.schema,'phicore369.workload.v1');
  assert.throws(()=>parseCalibrationArgs(['--report','one.json']),/Need/);
  assert.throws(()=>parseCalibrationArgs(['--arrivals','a','--report','a','--report','b','--budget-gib','0']),/budgetGiB/);
});

test('read-only observer never posts or issues generate requests',async()=>{
  const config=parseObserveArgs(['--samples','3','--interval-ms','100']);
  const calls=[];const sleeps=[];
  const deps={
    getJson:async url=>{
      calls.push(url);
      if(url.endsWith('/api/tags'))return {models:[{name:'qwen3:4b',digest:digests[0]}]};
      if(url.endsWith('/api/version'))return {version:'test'};
      if(url.endsWith('/api/ps'))return {models:[{name:'qwen3:4b',digest:digests[0],size:5e9,size_vram:4e9,expires_at:'later'}]};
      throw Error('unexpected request');
    },
    pause:async ms=>sleeps.push(ms),
    clock:()=> '2026-11-04T00:00:00Z',
    deviceInfo:()=>hardware
  };
  const result=await observe(config,deps);
  assert.equal(result.schema,OBSERVE_SCHEMA);
  assert.equal(result.snapshots.length,3);
  assert.equal(sleeps.length,2);
  assert.deepEqual(sleeps,[100,100]);
  assert.ok(calls.every(url=>url.includes('/api/tags')||url.includes('/api/version')||url.includes('/api/ps')));
  assert.ok(!JSON.stringify(result).includes('prompt'));
  assert.equal(result.snapshots[0].models[0].sizeVramBytes,4e9);
});

test('observer rejects remote endpoints, oversized samples and missing model list',async()=>{
  assert.throws(()=>parseObserveArgs(['--url','http://192.168.0.1:11434']),/loopback/);
  assert.throws(()=>parseObserveArgs(['--samples','121']),/samples/);
  const config=parseObserveArgs([]);
  await assert.rejects(()=>observe(config,{
    getJson:async url=>url.endsWith('/api/version')?{version:'mock'}:
      url.endsWith('/api/tags')?{models:[]}:{oops:'missing'},
    deviceInfo:()=>hardware
  }),/missing models list/);
});
