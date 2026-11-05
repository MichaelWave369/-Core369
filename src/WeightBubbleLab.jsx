import React, {useMemo, useState} from 'react';
import {comparePolicies, validateWorkload} from './weightbubble.js';
import {makeWorkload, WORKLOAD_IDS} from './workloads.js';

const number=(n,d=1)=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
const pct=n=>number(n*100,1)+'%';
const policyNames={none:'NO CACHE',lru:'STANDARD LRU',phi:'Φ WEIGHT BUBBLE'};
const palette=['#83efd0','#7b9fec','#e9b57f','#bda1df','#f08e8e','#93c8ee'];
const POLICIES=['none','lru','phi'];

function PolicyCard({type,result,best}) {
  const s=result.stats;
  return <div className={'bubble-policy '+(best?'bubble-best':'')}>
    <div className="bubble-policy-head"><span>{policyNames[type]}</span><strong>{best?'LOWEST MODELED LOAD':'TRACE REPLAY'}</strong></div>
    <div className="bubble-big">{number(s.estimatedLoadMs/1000,2)}<small> s reload</small></div>
    <div className="bubble-data"><span>Cache hit rate</span><strong>{pct(s.hitRate)}</strong></div>
    <div className="bubble-data"><span>Model loads</span><strong>{s.misses}</strong></div>
    <div className="bubble-data"><span>Capacity evictions</span><strong>{s.evictions}</strong></div>
    <div className="bubble-data"><span>Peak resident</span><strong>{number(s.peakResidentGiB,2)} GiB</strong></div>
    <div className="bubble-data"><span>Total modeled work</span><strong>{number(s.estimatedTotalMs/1000,2)} s</strong></div>
  </div>;
}

function ReplayChart({comparison}) {
  const runs=POLICIES.map(policy=>({policy,time:comparison.runs[policy].stats.estimatedLoadMs}));
  const max=Math.max(1,...runs.map(d=>d.time));
  return <div className="bubble-bars">
    <div className="bar-heading"><span>Modeled cumulative reload cost</span><span className="muted">Smaller bars mean less assumed loading time</span></div>
    {runs.map(({policy,time})=><div key={policy} className="bubble-bar-row">
      <span>{policyNames[policy]}</span>
      <div className="bubble-bar-track"><div className={'bubble-bar-fill '+policy} style={{width:time/max*100+'%'}} /></div>
      <strong>{number(time/1000,1)} s</strong>
    </div>)}
  </div>;
}

function MemoryStrip({event,models,budget,policy}) {
  const lookup=new Map(models.map(m=>[m.id,m]));
  const data=event?.resident?.map(id=>lookup.get(id)).filter(Boolean)||[];
  return <div className="bubble-strip">
    <div className="bar-heading"><span>{policyNames[policy]}</span><span className="muted">{number(event?.usedGiB??0,2)} / {number(budget,2)} GiB</span></div>
    <div className="bubble-memory-track">
      {data.map((m,i)=><div key={m.id} style={{width:m.sizeGiB/budget*100+'%',background:palette[models.findIndex(x=>x.id===m.id)%palette.length]}} title={m.id+' • '+number(m.sizeGiB)+' GiB'} />)}
    </div>
    <div className="bubble-model-tags">
      {data.length?data.map(m=><span key={m.id}>{m.id} <b>{number(m.sizeGiB,1)} GiB</b></span>):<span>Nothing resident</span>}
    </div>
    <div className="bubble-event-text">
      <strong>{event?.action==='hit'?'HIT':event?.action==='loaded'?'MISS → LOAD':event?.action==='oversize-bypass'?'MISS → OVERSIZE':'MISS → NO CACHE'}</strong>
      {event?.changes?.length>0?<span>Evicted: {event.changes.map(x=>x.id+' ('+x.reason+')').join(', ')}</span>:<span>No eviction on this request</span>}
    </div>
  </div>;
}

export default function WeightBubbleLab(){
  const [scenario,setScenario]=useState('bursts');
  const [trace,setTrace]=useState(()=>makeWorkload('bursts'));
  const [budgetGiB,setBudgetGiB]=useState(12);
  const [ttlMs,setTtlMs]=useState(0);
  const [halfLifeMs,setHalfLifeMs]=useState(30000);
  const [index,setIndex]=useState(0);
  const [importError,setImportError]=useState('');
  const [copyState,setCopyState]=useState('');
  const options={budgetGiB,ttlMs,halfLifeMs};
  const comparison=useMemo(()=>comparePolicies(trace,options),[trace,budgetGiB,ttlMs,halfLifeMs]);
  const bestCost=Math.min(...POLICIES.map(p=>comparison.runs[p].stats.estimatedLoadMs));
  const current=trace.requests[index];
  const changeScenario=id=>{
    setScenario(id);setTrace(makeWorkload(id));setIndex(0);setImportError('');setCopyState('');
  };
  const loadJson=async e=>{
    const file=e.target.files?.[0];e.target.value='';
    if(!file)return;
    try{
      if(file.size>750000)throw Error('Workload file exceeds 750 KB');
      const parsed=validateWorkload(JSON.parse(await file.text()));
      setTrace(parsed);setScenario('custom');setIndex(0);setImportError('');setCopyState('');
    }catch(error){setImportError(error instanceof Error?error.message:'Unable to parse file');}
  };
  const exportReplay=()=>{
    const doc={...comparison,input:trace,generatedFrom:'ΦCore369 R2C local browser simulator'};
    const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const element=document.createElement('a');
    element.href=url;element.download='phi-core369-r2c-replay.json';document.body.appendChild(element);
    element.click();element.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  };
  const copyTrace=async()=>{
    try{await navigator.clipboard.writeText(JSON.stringify(trace,null,2));setCopyState('TRACE COPIED');}
    catch{setCopyState('COPY BLOCKED');}
  };
  return <section id="bubble" className="bubble-section"><div className="container">
    <div className="section-heading">
      <div><div className="kicker">RUNG 02C / MEMORY POLICY LAB</div>
        <h2>Φ Weight Bubble Scheduler</h2>
        <p>Replay identical workloads through competing residency policies. Every byte must fit.</p>
      </div><div className="method-tag">OFFLINE SIMULATOR • NO OLLAMA CONTROL</div>
    </div>
    <div className="bubble-layout">
      <aside className="bubble-config">
        <div className="panel-head"><span>01 / WORKLOAD SOURCE</span><span>NO CLOUD</span></div>
        <div className="bubble-options">
          {WORKLOAD_IDS.map(id=><button key={id} onClick={()=>changeScenario(id)} className={'bubble-preset '+(scenario===id?'on':'')}>{makeWorkload(id).name}</button>)}
        </div>
        <div className="bubble-import-row">
          <label className="bubble-import"><input type="file" accept=".json,application/json" onChange={loadJson} />IMPORT YOUR TRACE</label>
          <button onClick={copyTrace} className="bubble-import">{copyState||'COPY CURRENT TRACE'}</button>
        </div>
        {importError&&<p className="import-error" role="alert">{importError}</p>}
        <div className="bubble-detail"><strong>{trace.name}</strong><p>{trace.description||'Imported local workload'}</p><span>{trace.models.length} model profiles · {trace.requests.length} sequential requests</span></div>
        <div className="control-divider">02 / MEMORY BUDGET</div>
        <label className="control"><div className="control-top"><span>Weight residency budget</span><strong>{number(budgetGiB)} GiB</strong></div>
          <input type="range" min="2" max="32" step=".5" value={budgetGiB} onChange={e=>setBudgetGiB(Number(e.target.value))} />
        </label>
        <label className="control"><div className="control-top"><span>Idle expiry (0 disables)</span><strong>{ttlMs===0?'Disabled':number(ttlMs/1000,0)+' s'}</strong></div>
          <input type="range" min="0" max="120000" step="10000" value={ttlMs} onChange={e=>setTtlMs(Number(e.target.value))}/>
        </label>
        <label className="control"><div className="control-top"><span>Reuse half-life</span><strong>{number(halfLifeMs/1000,0)} s</strong></div>
          <input type="range" min="5000" max="120000" step="5000" value={halfLifeMs} onChange={e=>setHalfLifeMs(Number(e.target.value))}/>
        </label>
        <div className="bubble-profile">
          <div className="bar-heading"><span>Assumed model costs</span></div>
          <table><thead><tr><th>Model</th><th>Size</th><th>Load</th></tr></thead><tbody>
            {trace.models.map(m=><tr key={m.id}><td>{m.id}</td><td>{number(m.sizeGiB)} GiB</td><td>{number(m.loadMs)} ms</td></tr>)}
          </tbody></table>
        </div>
        <p className="fine">The numbers above are hypothetical unless you replace them with measurements. Memory budget counts weights only, not KV cache, activations or runtime reserves.</p>
        <button onClick={exportReplay} className="btn export bubble-export">EXPORT FULL REPLAY JSON ↗</button>
      </aside>
      <div className="bubble-results">
        <div className="panel-head"><span>03 / POLICY COMPARISON</span><span>{trace.requests.length} REQUESTS REPLAYED</span></div>
        <div className="bubble-policy-grid">{POLICIES.map(policy=><PolicyCard key={policy} type={policy} result={comparison.runs[policy]} best={comparison.runs[policy].stats.estimatedLoadMs===bestCost}/>)}</div>
        <ReplayChart comparison={comparison}/>
        <div className="bubble-delta">
          <span>Φ versus LRU • modeled loading time</span>
          <strong>{comparison.phiVsLru.loadMsSaved>0?'+':comparison.phiVsLru.loadMsSaved<0?'−':''}{number(Math.abs(comparison.phiVsLru.loadMsSaved)/1000,2)} seconds {comparison.phiVsLru.loadMsSaved>0?'avoided':comparison.phiVsLru.loadMsSaved<0?'extra':'difference'}</strong>
          <p>{comparison.phiVsLru.winner==='phi'?'Φ uses less assumed reload time on this trace. This does not demonstrate real hardware performance.':comparison.phiVsLru.winner==='lru'?'Standard LRU performs better here. That is an important design result, not a failure to hide.':'Both policies tie on assumed reload time for this trace.'}</p>
        </div>
        <div className="bubble-ledger">
          <div className="bar-heading"><span>04 / EVICTION LEDGER</span><span className="muted">Step-by-step cache state</span></div>
          <div className="bubble-stepper">
            <button disabled={index<=0} onClick={()=>setIndex(i=>Math.max(0,i-1))}>← PREV</button>
            <label>Request {index+1} of {trace.requests.length} <input aria-label="Select trace request" type="range" min="0" max={trace.requests.length-1} value={index} onChange={e=>setIndex(Number(e.target.value))}/></label>
            <button disabled={index>=trace.requests.length-1} onClick={()=>setIndex(i=>Math.min(trace.requests.length-1,i+1))}>NEXT →</button>
          </div>
          <div className="bubble-current">t = {number(current.atMs/1000,1)} s <span>Request: <strong>{current.model}</strong></span></div>
          <div className="bubble-memory-pair">
            <MemoryStrip policy="lru" event={comparison.runs.lru.events[index]} models={trace.models} budget={budgetGiB}/>
            <MemoryStrip policy="phi" event={comparison.runs.phi.events[index]} models={trace.models} budget={budgetGiB}/>
          </div>
        </div>
        <div className="bubble-caveats"><strong>RESEARCH BOUNDARY</strong>
          <p>Simulation, not measured RTX inference. Policies only see past requests. All assumed load times are added, but requests do not queue; no inference concurrency, model quality or energy use is modeled. A model bigger than the budget is served without being retained. TTL applies when the next request arrives.</p>
          <p>We have not changed your local Ollama memory residency. A live admission/eviction controller would require explicit opt-in, real model footprint data, interference testing and a rollback path.</p>
        </div>
      </div>
    </div>
  </div></section>;
}
