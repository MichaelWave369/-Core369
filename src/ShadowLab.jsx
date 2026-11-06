import React, {useMemo,useState} from 'react';
import {validateShadowReport,shadowComparison} from './shadow.js';

const fmt=(n,d=1)=>typeof n==='number'&&Number.isFinite(n)?
  n.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
function Stat({name,value,unit,caption}) {
  return <div className="shadow-stat">
    <div className="eyebrow">{name}</div>
    <div className="shadow-stat-value">{value}<small> {unit}</small></div>
    <p>{caption}</p>
  </div>;
}
function SessionGraph({records}){
  const valid=records.filter(r=>r.ok);
  if(!valid.length)return <p className="fine">No successful Ollama requests to graph.</p>;
  const width=740,height=210;
  const max=Math.max(1,...valid.map(r=>r.clientTtftMs))*1.18;
  const plotW=width-65;
  const barW=Math.max(2,Math.min(24,plotW/valid.length*.72));
  return <div className="shadow-chart">
    <div className="bar-heading"><span>Actual Ollama first-text latency</span><span className="muted">Observed • milliseconds</span></div>
    <svg viewBox={'0 0 '+width+' '+height} role="img" aria-label="Actual first-text milliseconds from user-directed local Ollama requests">
      {[0,.5,1].map(v=><g key={v}>
        <line x1="40" x2={width-15} y1={180-155*v} y2={180-155*v} stroke="#2e4b60" strokeDasharray="4 6"/>
        <text x="34" y={185-155*v} textAnchor="end" fill="#87a9bb" fontSize="11">{fmt(max*v,0)}</text>
      </g>)}
      {valid.map((r,i)=>{
        const x=45+(i+.5)*plotW/valid.length;
        const bh=Math.max(1,155*r.clientTtftMs/max);
        return <rect key={r.sequence} x={x-barW/2} y={180-bh} width={barW} height={bh} rx="2" fill={i%2?'#82eaca':'#709ee2'}>
          <title>Request {r.sequence} • {r.model} • {fmt(r.clientTtftMs)} ms first text</title>
        </rect>;
      })}
      <text x="40" y="200" fill="#91afbd" fontSize="10">First successful request</text>
      <text x={width-15} y="200" textAnchor="end" fill="#91afbd" fontSize="10">Last</text>
    </svg>
  </div>;
}
export default function ShadowLab(){
  const [report,setReport]=useState(null);
  const [error,setError]=useState('');
  const [budget,setBudget]=useState(12);
  const results=useMemo(()=>report?shadowComparison(report,{budgetGiB:budget}):null,[report,budget]);
  const compare=results?.shadow;
  async function importFile(e){
    const f=e.target.files?.[0];e.target.value='';
    if(!f)return;
    try{
      if(f.size>1_500_000)throw Error('Shadow report exceeds 1.5 MB limit');
      const valid=validateShadowReport(JSON.parse(await f.text()));
      setReport(valid);setBudget(valid.manifest.replayOptions.budgetGiB);setError('');
    }catch(err){setError(err instanceof Error?err.message:'Unable to read report');}
  }
  const recorded=report?.records||[];
  return <section id="shadow" className="shadow-section"><div className="container">
    <div className="section-heading"><div>
      <div className="kicker">RUNG 02E / CONSENTED SHADOW REPLAY</div>
      <h2>Live workload evidence. Offline decisions.</h2>
      <p>Record your own foreground local inference requests, then compare proposed cache policies without executing them.</p>
    </div><div className="method-tag measure-tag">LOCAL ONLY • NO AUTO-EVICTION</div></div>
    <div className="shadow-notice">
      <div className="shadow-notice-symbol">E</div>
      <div><strong>Actual requests, simulated scheduler.</strong><p>This new client sends only prompts you explicitly type to your local Ollama. LRU and Φ run in shadow mode and cannot load, unload, or evict real models. It cannot capture requests made by other applications.</p></div>
    </div>
    <div className="shadow-layout">
      <aside className="shadow-setup">
        <div className="bar-heading"><span>01 / LOCAL OPERATOR SESSION</span></div>
        <p>Start with a calibrated R2D JSON profile containing at least two models, then explicitly enable your own requests.</p>
        <div className="shadow-code">
          <small>READ-ONLY PREVIEW</small>
          <code>node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b</code>
        </div>
        <div className="shadow-code">
          <small>EXPLICIT FOREGROUND INFERENCE</small>
          <code>node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b --execute</code>
        </div>
        <p className="fine">Use <code>/model name</code> to switch between calibrated installed models, <code>/status</code> for the current Ollama listing and <code>/quit</code> to save. Only type prompts you intend your local model to process. Your responses are printed, not written to the report.</p>
        <div className="control-divider">02 / IMPORT THE METADATA</div>
        <label className="import-button"><input type="file" accept=".json,application/json" onChange={importFile}/>
          {report?'REPLACE SHADOW REPORT':'IMPORT SHADOW SESSION JSON'} <span>↗</span>
        </label>
        {error&&<p role="alert" className="import-error">{error}</p>}
        <div className="shadow-file-status">{report?<>{recorded.length} request(s) recorded • {report.profiles.length} models</>:'No report imported yet'}</div>
        {report&&<><div className="control-divider">03 / SHADOW BUDGET</div>
          <label className="control"><div className="control-top"><span>Modeled GPU memory limit</span><strong>{fmt(budget)} GiB</strong></div>
            <input type="range" min="2" max="32" step=".5" value={budget} onChange={e=>setBudget(Number(e.target.value))}/>
          </label>
          <button className="text-btn" onClick={()=>{setReport(null);setError('');}}>CLEAR SESSION</button>
        </>}
        <p className="fine">The JSON stores model names, timings, metadata and request order, not the prompt text or model responses. Review hardware metadata before sharing.</p>
      </aside>
      <div className="shadow-results">
        {results?<><div className="panel-head"><span>04 / MEASURED SESSION</span><span>OLLAMA AS EXECUTED • NOT A Φ CONTROLLER</span></div>
          <div className="shadow-stat-grid">
            <Stat name="Actual requests" value={results.real.totalRequests} unit="" caption={results.failures+' failed attempts retained'}/>
            <Stat name="Median time to text" value={fmt(results.real.medianClientFirstTextMs)} unit="ms" caption="Client-observed, including queuing and first-token work"/>
            <Stat name="Median engine load" value={fmt(results.real.medianOllamaLoadMs)} unit="ms" caption="Ollama load_duration, across successful requests"/>
            <Stat name="Median decode" value={fmt(results.real.medianDecodeTokensPerSec)} unit="tok/s" caption="Observed eval_count / eval_duration"/>
          </div>
          <SessionGraph records={recorded}/>
          <div className="shadow-models">
            <div className="bar-heading"><span>Calibrated model profiles</span><span className="muted">From R2D evidence, not this session</span></div>
            <div className="shadow-profile-list">{report.profiles.map(p=><div key={p.id}><strong>{p.model}</strong>
              <span>{fmt(p.sizeGiB,2)} GiB snapshot · {fmt(p.loadMs,0)} ms baseline load</span>
            </div>)}</div>
          </div>
          {compare?<div className="shadow-compare">
            <div className="bar-heading"><span>05 / HYPOTHETICAL POLICY REPLAY</span><span className="hypothesis-tag">NOT APPLIED TO OLLAMA</span></div>
            <div className="shadow-replays">{['none','lru','phi'].map(policy=><div key={policy} className={'shadow-policy '+policy}>
              <span>{policy==='phi'?'Φ WEIGHT BUBBLE':policy==='lru'?'LRU':'NO CACHE'}</span>
              <strong>{fmt(compare.runs[policy].stats.estimatedLoadMs/1000,2)} s</strong>
              <small>Assumed reload cost • {compare.runs[policy].stats.misses} simulated misses</small>
            </div>)}</div>
            <p className="fine">{results.disclaimer}</p>
          </div>:<p className="fine">No successful requests: there is no shadow replay to compare. Failed requests remain recorded.</p>}
          <div className="shadow-ledger"><div className="bar-heading"><span>06 / CONSENTED REQUEST LEDGER</span><span className="muted">No prompts or responses retained</span></div>
            <div className="shadow-ledger-scroll"><table><thead><tr><th>#</th><th>Model</th><th>Arrival</th><th>Status</th><th>First text</th><th>Load</th></tr></thead>
              <tbody>{recorded.map(r=><tr key={r.sequence}><td>{r.sequence}</td><td>{r.model}</td><td>{fmt(r.atMs/1000,1)} s</td>
                <td>{r.ok?'OK':'Failed'}</td><td>{r.ok?fmt(r.clientTtftMs,0)+' ms':'—'}</td><td>{r.ok?fmt(r.loadSeconds*1000,0)+' ms':'—'}</td></tr>)}</tbody>
            </table></div>
          </div>
        </>:<div className="shadow-empty"><div className="residency-orbit">Φ</div><h3>Your real workloads, your control</h3>
          <p>Import a report created by the explicitly started local R2E client. No sample results are fabricated, and the public website cannot connect to or spy on Ollama.</p></div>}
      </div>
    </div>
  </div></section>;
}
