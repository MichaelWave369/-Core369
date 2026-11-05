import { TRACE_SCHEMA, validateWorkload } from './weightbubble.js';

// All scenarios are explicitly synthetic. Parameters are not RTX 5070 measurements.
const models = [
  {id:'assistant-8b',sizeGiB:5.2,loadMs:1250,inferMs:320},
  {id:'coder-7b',sizeGiB:4.6,loadMs:980,inferMs:280},
  {id:'vision-3b',sizeGiB:2.4,loadMs:720,inferMs:260},
  {id:'reasoner-14b',sizeGiB:9.4,loadMs:2350,inferMs:510}
];

const sequences = {
  'bursts': {
    name:'Creator workflow • rotating bursts',
    explanation:'Coding, small assistant and visual tasks arrive in bursts, with occasional expensive reasoning.',
    ids:Array.from({length:72},(_,i)=>{
      if(i%13===0) return 'reasoner-14b';
      if(i<24) return i%5===0?'vision-3b':i%3===0?'assistant-8b':'coder-7b';
      if(i<48) return i%4===0?'coder-7b':i%3===0?'assistant-8b':'vision-3b';
      return i%4===0?'vision-3b':i%3===0?'coder-7b':'assistant-8b';
    })
  },
  'round-robin':{
    name:'Memory pressure • round robin',
    explanation:'Four models are accessed cyclically. Watch caching policies thrash when memory is undersized.',
    ids:Array.from({length:72},(_,i)=>models[i%4].id)
  },
  'expensive':{
    name:'Long reload • asymmetric costs',
    explanation:'The highest-reload-cost model returns periodically between cheaper tasks.',
    ids:Array.from({length:72},(_,i)=>i%5===0?'reasoner-14b':i%2===0?'assistant-8b':'vision-3b')
  }
};

export const WORKLOAD_IDS = Object.keys(sequences);

export function makeWorkload(id = 'bursts') {
  const preset = sequences[id];
  if (!preset) throw Error('Unknown workload: ' + id);
  const trace = {
    schema:TRACE_SCHEMA,
    name:preset.name,
    description:'Synthetic teaching scenario. ' + preset.explanation + ' All bytes and timings are user-adjustable assumptions.',
    models:models.map(m=>({...m})),
    requests:preset.ids.map((model,index)=>({atMs:index*1400,model}))
  };
  return validateWorkload(trace);
}
