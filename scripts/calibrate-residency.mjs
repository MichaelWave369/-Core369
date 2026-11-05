#!/usr/bin/env node
// ΦCore369 R2D: offline, file-based conversion. No network or Ollama mutations.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {calibrateResidencyReports,calibrationSummary} from '../src/calibration.js';
import {comparePolicies,validateReplayOptions} from '../src/weightbubble.js';

export function parseCalibrationArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return {help:true};
  const config={reports:[],arrivals:'',out:'benchmarks/r2d-calibrated.json',budgetGiB:12,ttlMs:0,halfLifeMs:30000};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(!['--report','--arrivals','--out','--budget-gib','--ttl-ms','--half-life-ms'].includes(flag)||
       i+1>=argv.length||argv[i+1].startsWith('--')) throw Error('Unknown or missing option: '+flag);
    const value=argv[++i];
    if(flag==='--report')config.reports.push(value);
    else if(flag==='--arrivals')config.arrivals=value;
    else if(flag==='--out')config.out=value;
    else if(flag==='--budget-gib')config.budgetGiB=Number(value);
    else if(flag==='--ttl-ms')config.ttlMs=Number(value);
    else config.halfLifeMs=Number(value);
  }
  if(config.reports.length<2 || config.reports.length>30 || !config.arrivals || !config.out)throw Error('Need --arrivals, --out and at least two --report files');
  validateReplayOptions(config);
  return config;
}

export async function runCalibration(config, deps={}) {
  const read=deps.readFile||readFile;
  const input=JSON.parse(await read(resolve(config.arrivals),'utf8'));
  const reports=await Promise.all(config.reports.map(async file=>JSON.parse(await read(resolve(file),'utf8'))));
  const calibrated=calibrateResidencyReports(input,reports);
  const replay=comparePolicies(calibrated.trace,config);
  return {...calibrated,replay,disclaimer:'Calibrated input replay remains a simulation. No live model scheduler executed.'};
}

const HELP=[
'ΦCore369 R2D • Offline measured-profile trace calibration',
'',
'node scripts/calibrate-residency.mjs --arrivals examples/sample-arrivals.json \\',
'  --report benchmarks/model-a-r2b.json --report benchmarks/model-b-r2b.json \\',
'  --budget-gib 12 --out benchmarks/r2d-calibrated.json',
'',
'Each report must come from a separate completed isolated R2B experiment;',
'all must share the same host, Ollama version, prompt checksums and generation settings.',
'The arrivals file describes YOUR selected model sequence and times; the tool does',
'not claim those arrivals were measured. It never sends requests to Ollama.'
].join('\n');

export async function main(argv=process.argv.slice(2)){
  const config=parseCalibrationArgs(argv);
  if(config.help){console.log(HELP);return;}
  const output=await runCalibration(config);
  const path=resolve(config.out);
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(output,null,2)+'\n','utf8');
  const s=calibrationSummary(output);
  console.log('Calibrated '+s.models+' model(s) from '+s.sources+' reports, '+s.requests+' requested arrivals.');
  for(const p of ['none','lru','phi']){
    const stats=output.replay.runs[p].stats;
    console.log(p+': assumed load='+((stats.estimatedLoadMs)/1000).toFixed(2)+' s, hits='+stats.hits);
  }
  console.log('Saved '+path);
  console.log('Caution: these are replayed assumed costs, not measured multi-model scheduler performance.');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{console.error('Calibration failed:',error.message);process.exitCode=1;});
}
