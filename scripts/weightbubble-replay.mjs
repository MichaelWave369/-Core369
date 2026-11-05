#!/usr/bin/env node
/*
 * ΦCore369 R2C offline workload replay. NO Ollama calls and NO network.
 * Does not modify inference runtime or model residency.
 */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {comparePolicies, validateWorkload, validateReplayOptions} from '../src/weightbubble.js';
import {makeWorkload, WORKLOAD_IDS} from '../src/workloads.js';

export function parseReplayArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return {help:true};
  const config = {preset:'bursts',traceFile:null,budgetGiB:12,ttlMs:0,halfLifeMs:30000,out:'benchmarks/r2c-replay.json'};
  const map = {'--preset':'preset','--trace':'traceFile','--budget-gib':'budgetGiB',
    '--ttl-ms':'ttlMs','--half-life-ms':'halfLifeMs','--out':'out'};
  for (let i=0;i<args.length;i++) {
    const key=map[args[i]];
    if(!key || i+1===args.length || args[i+1].startsWith('--')) throw Error('Invalid or missing argument: '+args[i]);
    config[key]=args[++i];
  }
  if (config.traceFile !== null && config.preset !== 'bursts') throw Error('Use either --preset or --trace');
  if(config.traceFile===null && !WORKLOAD_IDS.includes(config.preset)) throw Error('Unknown preset');
  config.budgetGiB=Number(config.budgetGiB);
  config.ttlMs=Number(config.ttlMs);
  config.halfLifeMs=Number(config.halfLifeMs);
  validateReplayOptions(config);
  if(typeof config.out!=='string'||!config.out.trim())throw Error('Output path required');
  return config;
}
const HELP = [
  'ΦCore369 R2C • Offline model-residency replay',
  '',
  'node scripts/weightbubble-replay.mjs --preset bursts --budget-gib 12',
  'node scripts/weightbubble-replay.mjs --trace examples/my-workload.json --budget-gib 12',
  '',
  '--preset bursts|round-robin|expensive  Built-in synthetic trace',
  '--trace PATH       Import your own versioned workload JSON',
  '--budget-gib N    Weights-only hypothetical resident memory budget',
  '--ttl-ms N        Idle expiry in milliseconds (0 disables)',
  '--half-life-ms N  Φ policy recency-decay half-life (default 30000)',
  '--out PATH        Saved local JSON report; no network activity'
].join('\n');

export async function runReplay(config, deps = {}) {
  const read = deps.readFile || readFile;
  const trace = config.traceFile
    ? validateWorkload(JSON.parse(await read(resolve(config.traceFile),'utf8')))
    : makeWorkload(config.preset);
  return {...comparePolicies(trace,config),input:trace,
    generatedFrom:'ΦCore369 R2C offline trace replay; assumed sizes/timings; not a measured benchmark'};
}

export async function main(argv=process.argv.slice(2)) {
  const config=parseReplayArgs(argv);
  if(config.help){console.log(HELP);return;}
  const replay=await runReplay(config);
  const output=resolve(config.out);
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(replay,null,2)+'\n','utf8');
  const {none,lru,phi}=replay.runs;
  console.log('Trace: '+replay.scenario+' | budget '+config.budgetGiB+' GiB');
  for(const run of [none,lru,phi]){
    console.log(run.policy.padEnd(5)+' loads='+run.stats.misses+
      ' evictions='+run.stats.evictions+' reloadSeconds='+
      (run.stats.estimatedLoadMs/1000).toFixed(2)+
      ' peakGiB='+run.stats.peakResidentGiB.toFixed(2));
  }
  console.log('Saved '+output);
  console.log('These are assumed workload replay results, not actual Ollama/GPU throughput.');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{console.error('Replay failed:',error.message);process.exitCode=1;});
}
