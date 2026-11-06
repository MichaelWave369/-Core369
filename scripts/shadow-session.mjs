#!/usr/bin/env node
/*
 * ΦCore369 R2E: explicitly consented, foreground LOCAL prompt client.
 * The only POST is the user's own requested inference to /api/generate.
 * No preloading, unloading, keep_alive, interception, or system-level proxy.
 * Prompt and generated text are never persisted by this program.
 */
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createInterface} from 'node:readline/promises';
import {deviceInfo} from './ollama-bench.mjs';
import {createShadowReport, appendShadowRecord, shadowComparison, validateCalibrationForShadow} from '../src/shadow.js';
import {validateReplayOptions} from '../src/weightbubble.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validInt=(value,label,lo,hi)=>{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<lo||n>hi)throw Error(label+' must be an integer '+lo+'..'+hi);
  return n;
};
function localUrl(origin) {
  let u;
  try{u=new URL(origin);}catch{throw Error('Invalid Ollama URL');}
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||
    u.pathname!=='/'||u.search||u.hash||u.username||u.password){
    throw Error('Only unauthenticated plain-HTTP loopback Ollama is allowed');
  }
  return u.origin;
}

export function parseShadowArgs(argv) {
  if(argv.includes('--help')||argv.includes('-h'))return {help:true};
  const config={
    profiles:'',model:'',budgetGiB:12,ttlMs:0,halfLifeMs:30000,
    maxRequests:30,timeoutMs:180000,url:'http://127.0.0.1:11434',
    out:'benchmarks/r2e-shadow-session.json',execute:false
  };
  const flags={'--profiles':'profiles','--model':'model','--budget-gib':'budgetGiB',
    '--ttl-ms':'ttlMs','--half-life-ms':'halfLifeMs','--max-requests':'maxRequests',
    '--timeout-ms':'timeoutMs','--url':'url','--out':'out'};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--execute'){config.execute=true;continue;}
    const key=flags[argv[i]];
    if(!key||i+1>=argv.length||argv[i+1].startsWith('--'))throw Error('Unknown or incomplete option: '+argv[i]);
    config[key]=argv[++i];
  }
  if(!config.profiles||!config.model||!config.out)throw Error('Required: --profiles, --model, --out');
  config.budgetGiB=Number(config.budgetGiB);
  config.ttlMs=Number(config.ttlMs);
  config.halfLifeMs=Number(config.halfLifeMs);
  validateReplayOptions(config);
  config.maxRequests=validInt(config.maxRequests,'--max-requests',1,120);
  config.timeoutMs=validInt(config.timeoutMs,'--timeout-ms',1000,600000);
  config.url=localUrl(config.url);
  return config;
}

async function getJson(url) {
  const response=await fetch(url,{method:'GET',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Ollama GET HTTP '+response.status);
  return response.json();
}

export async function preflightShadow(config,calibration,deps={}) {
  const derived=validateCalibrationForShadow(calibration);
  if(!derived.profiles.some(p=>p.model===config.model))throw Error('Selected model is absent from the calibrated allowlist');
  const get=deps.getJson||getJson;
  const [tags,version]=await Promise.all([get(config.url+'/api/tags'),get(config.url+'/api/version')]);
  if(String(version.version||'unknown')!==derived.backendVersion)throw Error('Ollama version changed since R2D calibration; recollect baselines');
  for(const profile of derived.profiles){
    const local=(tags.models||[]).find(m=>m.name===profile.model||m.model===profile.model);
    if(!local || local.digest?.toLowerCase()!==profile.digest.toLowerCase()){
      throw Error('Installed model digest mismatch: '+profile.model+'; recollect or update calibration');
    }
  }
  const device=(deps.deviceInfo||deviceInfo)();
  if(device.os!==derived.hardware.os || device.cpu!==derived.hardware.cpu ||
     (device.gpu?.name||null)!==(derived.hardware.gpu?.name||null)){
    throw Error('Hardware identity changed since calibration. Run matched R2B measurements on this host.');
  }
  return derived;
}

export async function streamLocalGeneration(url,body,onText=()=>{},timeoutMs=180000,requestFetch=fetch){
  const started=performance.now();
  const response=await requestFetch(url+'/api/generate',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:body.model,prompt:body.prompt,stream:true,options:body.options}),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok||!response.body)throw Error('Local Ollama inference HTTP '+response.status);
  const decoder=new TextDecoder();
  let buffer='',final=null,firstTextMs=null;
  const consume=line=>{
    if(!line.trim())return;
    const event=JSON.parse(line);
    if(event.error)throw Error('Local Ollama generation error: '+String(event.error).slice(0,200));
    if(typeof event.response==='string'&&event.response){
      if(firstTextMs===null)firstTextMs=performance.now()-started;
      onText(event.response); // Only forwards to caller. Never retained.
    }
    if(event.done)final=event;
  };
  for await(const chunk of response.body){
    buffer+=decoder.decode(chunk,{stream:true});
    if(buffer.length>2_000_000)throw Error('Excessive unparsed response from Ollama');
    let newline;
    while((newline=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}
  }
  buffer+=decoder.decode();
  if(buffer.trim())consume(buffer);
  if(!final || !Number.isFinite(final.eval_count)||final.eval_count<=0||
     !Number.isFinite(final.eval_duration)||final.eval_duration<=0||
     firstTextMs===null)throw Error('Incomplete Ollama stream metrics or no visible response');
  const seconds=n=>Number.isFinite(n)&&n>=0?n/1e9:0;
  return {
    generatedTokens:final.eval_count,
    totalSeconds:seconds(final.total_duration),
    loadSeconds:seconds(final.load_duration),
    decodeTokensPerSec:final.eval_count*1e9/final.eval_duration,
    clientTtftMs:Math.max(0,Number(firstTextMs.toFixed(2)))
  };
}

export async function runShadowSession(config,calibration,deps={}) {
  if(!config.execute)throw Error('Shadow session requires explicit --execute consent');
  const derived=await preflightShadow(config,calibration,deps);
  const ask=deps.ask;
  if(typeof ask!=='function')throw Error('Interactive prompt provider required');
  const now=deps.now||(()=>performance.now());
  const utc=deps.utc||(()=>new Date().toISOString());
  const print=deps.print||(()=>{});
  const generate=deps.generate||streamLocalGeneration;
  const get=deps.getJson||getJson;
  let report=createShadowReport(calibration,{
    sessionId:(deps.uuid||randomUUID)(),startedUtc:utc(),
    replayOptions:config
  });
  let model=config.model;
  const start=now();
  let stopped='operator-quit';
  while(report.records.length<config.maxRequests){
    let input;
    try{input=await ask('['+model+'] > ');}catch{stopped='input-closed';break;}
    if(input==null){stopped='input-closed';break;}
    const line=String(input).trim();
    if(!line)continue;
    if(line==='/quit'||line==='/exit'){stopped='operator-quit';break;}
    if(line==='/help'){print('/model <name> switches allowlisted model; /status lists Ollama residency; /quit saves & exits.');continue;}
    if(line==='/status'){
      try{
        const ps=await get(config.url+'/api/ps');
        const names=Array.isArray(ps.models)?ps.models.map(x=>x.name||x.model):[];
        print('Ollama currently lists: '+(names.join(', ')||'(none)'));
      }catch(error){print('Status check failed: '+error.message);}
      continue;
    }
    if(line.startsWith('/model ')){
      const next=line.slice(7).trim();
      if(!derived.profiles.some(p=>p.model===next)){print('Not allowlisted: '+next);continue;}
      model=next;print('Selected model: '+model);continue;
    }
    if(line.startsWith('/')){print('Unknown command. /help lists supported commands.');continue;}
    if(line.length>8000){print('Prompt exceeds the 8,000-character limit');continue;}
    const previousAt=report.records.at(-1)?.atMs??0;
    const atMs=Math.max(previousAt,Math.floor(now()-start));
    try{
      const data=await generate(config.url,{model,prompt:line,options:derived.options},
        chunk=>print(chunk,true),config.timeoutMs);
      report=appendShadowRecord(report,{atMs,model,ok:true,...data});
      print('\nActual Ollama: '+data.decodeTokensPerSec.toFixed(1)+' tok/s decode; '+data.clientTtftMs.toFixed(0)+' ms to first text.');
    }catch(error){
      report=appendShadowRecord(report,{atMs,model,ok:false,error:'Local inference failed; diagnostic text deliberately not retained'});
      print('\nInference failed: '+String(error?.message||error).slice(0,240));
    }
    const current=shadowComparison(report);
    if(current.shadow){
      print('SHADOW ONLY • LRU modeled load '+(current.shadow.runs.lru.stats.estimatedLoadMs/1000).toFixed(2)+
        ' s / Φ modeled load '+(current.shadow.runs.phi.stats.estimatedLoadMs/1000).toFixed(2)+' s (NO live policy applied).');
    }
  }
  if(report.records.length>=config.maxRequests)stopped='request-limit';
  report={...report,manifest:{...report.manifest,endedUtc:utc(),exitReason:stopped}};
  return report;
}

const HELP=[
'ΦCore369 R2E • consented local request session + shadow policies',
'',
'Read-only setup validation (no Ollama requests):',
' node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b',
'',
'Interactive inference (ONLY explicitly submitted prompts):',
' node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b --execute',
'',
'Flags: --profiles, --model, --budget-gib, --ttl-ms, --half-life-ms,',
' --max-requests (1–120), --timeout-ms, --out, --url (loopback), --execute',
'Commands inside session: /model <allowlisted-name>, /status, /help, /quit.',
'',
'No prompt/response is written to report. No automatic model evictions or preloads.',
'No interception of traffic from other apps. Ollama itself may manage residency as usual.'
].join('\n');

export async function main(argv=process.argv.slice(2)) {
  const config=parseShadowArgs(argv);
  if(config.help){console.log(HELP);return;}
  const calibration=JSON.parse(await readFile(resolve(config.profiles),'utf8'));
  const derived=validateCalibrationForShadow(calibration);
  if(!derived.profiles.some(p=>p.model===config.model))throw Error('Selected model absent from calibrated allowlist');
  console.log('Profiles: '+derived.profiles.map(x=>x.model).join(', '));
  console.log('Mode: '+(config.execute?'operator-consented local inference':'DRY RUN, zero Ollama requests'));
  console.log('No prompt/output data will be saved. Shadow LRU/Φ never controls residency.');
  if(!config.execute){
    console.log('Use --execute to allow foreground prompts. Do not type credentials or private secrets.');
    return;
  }
  const rl=createInterface({input:process.stdin,output:process.stdout,terminal:process.stdin.isTTY});
  console.log('Only models from the R2D allowlist are permitted. /quit saves the metadata report.');
  let report;
  try{
    report=await runShadowSession(config,calibration,{
      ask:async label=>rl.question(label),
      print:(s,raw=false)=>raw?process.stdout.write(s):console.log(s)
    });
  }finally{rl.close();}
  if(!report)throw Error('Session failed before report creation');
  const out=resolve(config.out);
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(report,null,2)+'\n','utf8');
  console.log('Saved '+report.records.length+' metadata-only requests to '+out);
  console.log('Import the JSON into the R2E Shadow Session Lab. This was NOT a live scheduler test.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{console.error('Shadow session failed:',error.message);process.exitCode=1;});
}
