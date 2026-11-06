#!/usr/bin/env node
/* Read-only P3 comparison: no network, no model/hardware commands, no writes. */
import {readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parsePhotonicsP2, PHOTONICS_P2_MAX_BYTES} from '../src/photonics-p2.js';
import {comparePhotonicsP2} from '../src/photonics-p3.js';

export async function readP2(path){
  const absolute=resolve(path);
  const info=await stat(absolute);
  if(!info.isFile()||info.size>PHOTONICS_P2_MAX_BYTES)
    throw Error('P2 report must be a regular file at most 256 KiB');
  return parsePhotonicsP2(await readFile(absolute,'utf8'));
}

export async function main(argv=process.argv.slice(2)){
  if(argv.length!==2 || argv.some(x=>x==='--help'||x==='-h')){
    if(argv.length===1 && ['--help','-h'].includes(argv[0])){
      console.log('Usage: node scripts/compare-photonics-p3.mjs FIRST_P2.json SECOND_P2.json');
      return;
    }
    throw Error('Usage: node scripts/compare-photonics-p3.mjs FIRST_P2.json SECOND_P2.json');
  }
  if(resolve(argv[0])===resolve(argv[1]))
    throw Error('Two different report paths are required');
  const [first,second]=await Promise.all(argv.map(readP2));
  const result=comparePhotonicsP2(first,second);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  process.stderr.write(
    'P3 exploratory repeatability: '+result.warnings.length+
    ' timing/accuracy drift flags; no physical photonic hardware tested.\n'
  );
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
