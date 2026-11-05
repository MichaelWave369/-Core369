#!/usr/bin/env node
/*
 * ΦCore369 R2D: READ-ONLY Ollama /api/ps residency snapshots.
 * Never POSTs, unloads, preloads, or infers from prompts. Does not record
 * user text or claim /api/ps is a full memory profiler.
 */
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deviceInfo} from './ollama-bench.mjs';

export const OBSERVE_SCHEMA='phicore369.ollama-observation.v1';
function integer(value,name,min,max) {
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(name+' must be an integer between '+min+' and '+max);
  return n;
}
function loopbackOrigin(value) {
  let url;
  try{url=new URL(value);}catch{throw Error('Invalid Ollama endpoint');}
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||
    url.username||url.password||url.pathname!=='/'||url.search||url.hash){
    throw Error('Ollama endpoint must use plain HTTP on loopback without path or credentials');
  }
  return url.origin;
}
export function parseObserveArgs(argv) {
  if(argv.includes('--help')||argv.includes('-h'))return {help:true};
  const config={url:'http://127.0.0.1:11434',samples:1,intervalMs:1000,out:'benchmarks/ollama-observation.json'};
  const map={'--url':'url','--samples':'samples','--interval-ms':'intervalMs','--out':'out'};
  for(let i=0;i<argv.length;i++){
    const key=map[argv[i]];
    if(!key||i+1>=argv.length||argv[i+1].startsWith('--'))throw Error('Unknown or incomplete option: '+argv[i]);
    config[key]=argv[++i];
  }
  config.url=loopbackOrigin(config.url);
  config.samples=integer(config.samples,'--samples',1,120);
  config.intervalMs=integer(config.intervalMs,'--interval-ms',100,60000);
  if(typeof config.out!=='string'||!config.out.trim())throw Error('Output path required');
  return config;
}
async function getJson(url){
  const result=await fetch(url,{method:'GET',signal:AbortSignal.timeout(15000)});
  if(!result.ok)throw Error('Ollama '+url.split('/').pop()+' HTTP '+result.status);
  return result.json();
}
export async function observe(config,deps={}){
  const get=deps.getJson||getJson;
  const pause=deps.pause||((ms)=>new Promise(done=>setTimeout(done,ms)));
  const clock=deps.clock||(()=>new Date().toISOString());
  const [version,tags]=await Promise.all([get(config.url+'/api/version'),get(config.url+'/api/tags')]);
  const snapshots=[];
  for(let i=0;i<config.samples;i++){
    if(i)await pause(config.intervalMs);
    const result=await get(config.url+'/api/ps');
    if(!Array.isArray(result.models))throw Error('Ollama /api/ps response missing models list');
    snapshots.push({
      utc:clock(),
      models:result.models.slice(0,100).map(m=>({
        name:typeof m.name==='string'?m.name:(typeof m.model==='string'?m.model:'unknown'),
        digest:typeof m.digest==='string'?m.digest:null,
        sizeBytes:Number.isFinite(m.size)&&m.size>=0?m.size:null,
        sizeVramBytes:Number.isFinite(m.size_vram)&&m.size_vram>=0?m.size_vram:null,
        expiresAt:typeof m.expires_at==='string'?m.expires_at:null
      }))
    });
  }
  return {
    schema:OBSERVE_SCHEMA,
    source:'read-only-local-ollama-api',
    manifest:{
      sessionId:randomUUID(),utc:clock(),backendVersion:String(version.version||'unknown'),
      hardware:(deps.deviceInfo||deviceInfo)(),
      availableModelDigests:(Array.isArray(tags.models)?tags.models:[]).slice(0,100).map(m=>({
        name:m.name||m.model||'unknown',digest:m.digest||null
      })),
      samples:config.samples,intervalMs:config.intervalMs,
      caveat:'Only timestamped /api/ps snapshots. This does not measure per-request traffic, memory peaks, latency, or energy.'
    },
    snapshots
  };
}
const HELP=[
  'ΦCore369 R2D • Read-only Ollama residency snapshots',
  'node scripts/ollama-observe.mjs --samples 6 --interval-ms 2000',
  'Use --out to choose the JSON location. Only localhost Ollama HTTP is permitted.',
  'The tool reads /api/tags, /api/version and /api/ps. It never POSTs or modifies model residency.'
].join('\n');
export async function main(argv=process.argv.slice(2)){
  const config=parseObserveArgs(argv);
  if(config.help){console.log(HELP);return;}
  const report=await observe(config);
  const path=resolve(config.out);
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(report,null,2)+'\n','utf8');
  console.log('Saved '+report.snapshots.length+' read-only snapshots to '+path);
  console.log('This is active-model metadata only, not a request log or an energy/peak-memory measurement.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{console.error('Observe failed:',error.message);process.exitCode=1;});
}
