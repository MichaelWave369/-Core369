import test from 'node:test';
import assert from 'node:assert/strict';
import {CALIBRATION_SCHEMA} from '../src/calibration.js';
import {TRACE_SCHEMA} from '../src/weightbubble.js';
import {
  SHADOW_SCHEMA,validateCalibrationForShadow,createShadowReport,
  validateShadowReport,appendShadowRecord,shadowComparison
} from '../src/shadow.js';
import {parseShadowArgs,preflightShadow,streamLocalGeneration,runShadowSession} from '../scripts/shadow-session.mjs';

const digestA='a'.repeat(64),digestB='b'.repeat(64);
const hardware={os:'mock OS',cpu:'mock CPU',gpu:null};
function calibration(){
  return {
    schema:CALIBRATION_SCHEMA,source:'derived-r2b-calibration',
    manifest:{
      backend:'ollama',backendVersion:'mock-1',hardware,
      generationOptions:{num_ctx:4096,num_predict:96,seed:369,temperature:0},
      sourceReports:[
        {model:'a:1b',id:'a:1b',modelDigest:digestA},
        {model:'b:2b',id:'b:2b',modelDigest:digestB}
      ]
    },
    trace:{
      schema:TRACE_SCHEMA,name:'R2D calibrated trace',
      models:[
        {id:'a:1b',sizeGiB:2,loadMs:600,inferMs:200},
        {id:'b:2b',sizeGiB:4,loadMs:1500,inferMs:300}
      ],
      requests:[{atMs:0,model:'a:1b'},{atMs:1000,model:'b:2b'}]
    }
  };
}
const conf=()=>parseShadowArgs(['--profiles','calibrated.json','--model','a:1b','--execute']);
const info={
  generatedTokens:30,totalSeconds:1.5,loadSeconds:.5,decodeTokensPerSec:30,clientTtftMs:180
};
function deps(answers=[]){
  const events=[],sent=[];
  const items=[...answers];
  let t=0;
  return {
    events,sent,
    deviceInfo:()=>structuredClone(hardware),
    getJson:async url=>{
      events.push(url);
      if(url.endsWith('/api/tags'))return {models:[
        {name:'a:1b',digest:digestA},{name:'b:2b',digest:digestB}
      ]};
      if(url.endsWith('/api/version'))return {version:'mock-1'};
      if(url.endsWith('/api/ps'))return {models:[{name:'a:1b'}]};
      throw Error('unexpected GET '+url);
    },
    ask:async()=>items.shift()??null,
    generate:async (url,body,onText)=>{
      sent.push({url,body});
      onText('Hello from local model');
      return info;
    },
    now:()=>{t+=1000;return t;},
    utc:()=> '2026-11-04T23:00:00.000Z',
    uuid:()=> 'session-test',
    print:()=>{}
  };
}

test('dry-run CLI is safe and rejects remote origins',()=>{
  assert.equal(parseShadowArgs(['--help']).help,true);
  const dry=parseShadowArgs(['--profiles','file','--model','a:1b']);
  assert.equal(dry.execute,false);
  assert.throws(()=>parseShadowArgs(['--profiles','file','--model','a:1b','--url','http://192.168.1.2:11434']),/loopback/);
  assert.throws(()=>parseShadowArgs(['--profiles','file','--model','a:1b','--url','https://localhost:11434']),/loopback/);
  assert.throws(()=>parseShadowArgs(['--profiles','file','--model','a:1b','--max-requests','121']),/max-requests/);
  assert.throws(()=>parseShadowArgs(['--model','a:1b']),/Required/);
});

test('calibration allowlist binds names to measured digests and profiles',()=>{
  const p=validateCalibrationForShadow(calibration());
  assert.equal(p.profiles.length,2);
  assert.equal(p.profiles[0].sizeGiB,2);
  const duplicate=calibration();
  duplicate.manifest.sourceReports[1].model='a:1b';
  assert.throws(()=>validateCalibrationForShadow(duplicate),/duplicate/);
  const missing=calibration();
  missing.trace.models[0].sizeGiB=-1;
  assert.throws(()=>validateCalibrationForShadow(missing),/sizeGiB/);
});

test('preflight verifies installed model digests, Ollama version and hardware',async()=>{
  const d=deps();
  const p=await preflightShadow(conf(),calibration(),d);
  assert.equal(p.profiles.length,2);
  assert.ok(d.events.every(url=>url.includes('/api/tags')||url.includes('/api/version')));
  const bad=deps();const get=bad.getJson;
  bad.getJson=async url=>url.endsWith('/api/version')?{version:'changed'}:get(url);
  await assert.rejects(()=>preflightShadow(conf(),calibration(),bad),/version changed/);
  const mismatch=deps();const old=mismatch.getJson;
  mismatch.getJson=async url=>url.endsWith('/api/tags')?{models:[
    {name:'a:1b',digest:digestA},{name:'b:2b',digest:digestA}
  ]}:old(url);
  await assert.rejects(()=>preflightShadow(conf(),calibration(),mismatch),/digest mismatch/);
  const machine=deps();
  machine.deviceInfo=()=>({...hardware,cpu:'another CPU'});
  await assert.rejects(()=>preflightShadow(conf(),calibration(),machine),/Hardware identity/);
});

test('all prompt text is stripped from saved reports and shadow never controls models',async()=>{
  const d=deps(['my SECRET prompt','/model b:2b','another private prompt','/status','/quit']);
  const r=await runShadowSession(conf(),calibration(),d);
  validateShadowReport(r);
  assert.equal(r.schema,SHADOW_SCHEMA);
  assert.equal(r.records.length,2);
  assert.deepEqual(r.records.map(x=>x.model),['a:1b','b:2b']);
  assert.ok(r.records.every(x=>x.ok));
  const output=JSON.stringify(r);
  assert.ok(!output.includes('SECRET'));
  assert.ok(!output.includes('private prompt'));
  assert.ok(!output.includes('Hello from local model'));
  assert.equal(r.manifest.residencyControl,'none; Ollama default policies only');
  assert.equal(d.sent.length,2);
  assert.ok(d.sent.every(x=>x.url==='http://127.0.0.1:11434' && x.body.options.num_ctx===4096));
  assert.ok(d.events.every(x=>!x.includes('/api/generate')));
  const analysis=shadowComparison(r);
  assert.equal(analysis.real.totalRequests,2);
  assert.equal(analysis.succeeded,2);
  assert.equal(analysis.shadow.runs.lru.stats.requests,2);
  assert.equal(analysis.shadow.runs.phi.stats.requests,2);
  assert.equal(analysis.real.generatedTokens,60);
});

test('run without explicit --execute makes no inference request',async()=>{
  const d=deps(['hello','/quit']);
  await assert.rejects(()=>runShadowSession(parseShadowArgs(['--profiles','x','--model','a:1b']),calibration(),d),/execute/);
  assert.equal(d.sent.length,0);
  assert.equal(d.events.length,0);
});

test('unknown models and unsupported commands cannot trigger generation',async()=>{
  const d=deps(['/model anything','/unknown','/model b:2b','hello','/quit']);
  const result=await runShadowSession(conf(),calibration(),d);
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].model,'b:2b');
  assert.equal(d.sent.length,1);
});

test('failures remain recorded and do not count as successful replay arrivals',async()=>{
  const d=deps(['first private','/model b:2b','second private','/quit']);
  const old=d.generate;let calls=0;
  d.generate=async(...args)=>{calls++;if(calls===1)throw Error('local timeout');return old(...args);};
  const result=await runShadowSession(conf(),calibration(),d);
  assert.equal(result.records.length,2);
  assert.equal(result.records[0].ok,false);
  assert.equal(result.records[1].ok,true);
  const analysis=shadowComparison(result);
  assert.equal(analysis.failures,1);
  assert.equal(analysis.shadow.runs.phi.stats.requests,1);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('report rejects malformed data, prompt leaks and injected false measurements',()=>{
  const base=createShadowReport(calibration(),{
    sessionId:'test',startedUtc:'2026-11-04T23:00:00.000Z',
    replayOptions:{budgetGiB:12}
  });
  const r=appendShadowRecord(base,{atMs:10,model:'a:1b',ok:true,
    ...info,prompt:'never persist me',response:'do not retain'});
  assert.ok(!JSON.stringify(r).includes('never persist'));
  assert.ok(!JSON.stringify(r).includes('do not retain'));
  assert.throws(()=>appendShadowRecord(r,{atMs:0,model:'a:1b',ok:true,...info}),/record fields/);
  assert.throws(()=>appendShadowRecord(r,{atMs:20,model:'unknown',ok:true,...info}),/allowlist/);
  const tampered=structuredClone(r);tampered.records[0].prompt='secret';
  assert.throws(()=>validateShadowReport(tampered),/record fields/);
  const infinite=structuredClone(r);infinite.records[0].clientTtftMs=Infinity;
  assert.throws(()=>validateShadowReport(infinite),/timings/);
});

test('streaming generation forwards response but returns ONLY metrics',async()=>{
  const events=[
    JSON.stringify({done:false,response:'Hello '}),
    JSON.stringify({done:false,response:'model!'}),
    JSON.stringify({done:true,response:'',eval_count:20,eval_duration:2000000000,
      total_duration:2400000000,load_duration:400000000})
  ].join('\n')+'\n';
  const bytes=new TextEncoder().encode(events);
  let captured='',posted=null;
  const mockFetch=async (_url,init)=>{
    posted=JSON.parse(init.body);
    const body=new ReadableStream({start(controller){
      controller.enqueue(bytes.subarray(0,24));
      controller.enqueue(bytes.subarray(24));
      controller.close();
    }});
    return new Response(body,{status:200});
  };
  const r=await streamLocalGeneration('http://127.0.0.1:11434',{
    model:'a:1b',prompt:'user secret',options:{num_ctx:4096}
  },text=>{captured+=text;},120000,mockFetch);
  assert.equal(captured,'Hello model!');
  assert.equal(r.generatedTokens,20);
  assert.equal(r.decodeTokensPerSec,10);
  assert.equal(r.loadSeconds,.4);
  assert.ok(r.clientTtftMs>=0);
  assert.ok(!JSON.stringify(r).includes('Hello model'));
  assert.ok(!Object.hasOwn(posted,'keep_alive'));
  assert.equal(posted.stream,true);
});
