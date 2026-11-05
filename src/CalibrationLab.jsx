import React, {useMemo, useState} from 'react';
import {calibrateResidencyReports,validateArrivals} from './calibration.js';
import {comparePolicies} from './weightbubble.js';

const display=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
const MB=1024*1024;
export default function CalibrationLab() {
  const [reports,setReports]=useState([]);
  const [arrivals,setArrivals]=useState(null);
  const [budget,setBudget]=useState(12);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const calibrated=useMemo(()=>{
    try{return reports.length>=2&&arrivals?{value:calibrateResidencyReports(arrivals,reports),error:null}:{value:null,error:null};}
    catch(e){return {value:null,error:e.message};}
  },[reports,arrivals]);
  const comparison=useMemo(()=>calibrated.value?comparePolicies(calibrated.value.trace,{budgetGiB:budget}):null,[calibrated.value,budget]);
  async function receiveReports(event) {
    const inputFiles=[...event.target.files||[]];event.target.value='';
    if (!inputFiles.length) return;
    try {
      if(inputFiles.length>30) throw Error('Select no more than 30 R2B reports');
      const incoming=[];
      for(const file of inputFiles){
        if(file.size>2*MB)throw Error('R2B file exceeds 2 MB: '+file.name);
        incoming.push(JSON.parse(await file.text()));
      }
      setReports(incoming);setError('');setNotice('Loaded '+incoming.length+' local report file(s)');
    } catch(e){setError(e.message);setNotice('');}
  }
  async function receiveArrivals(event){
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    try{
      if(file.size>750000)throw Error('Arrival file exceeds 750 KB');
      const parsed=validateArrivals(JSON.parse(await file.text()));
      setArrivals(parsed);setError('');setNotice('Loaded local arrival sequence');
    }catch(e){setError(e.message);setNotice('');}
  }
  const download=(kind)=>{
    if(!calibrated.value)return;
    const body=kind==='trace'?calibrated.value.trace:{
      ...calibrated.value,replay:comparison,
      disclaimer:'Derived measured-profile trace replay, NOT measured scheduler performance.'
    };
    const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;
    a.download=kind==='trace'?'phi-core369-measured-profile-trace.json':'phi-core369-r2d-calibration.json';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const delta=comparison?.phiVsLru?.loadMsSaved;
  return <section id="calibration" className="calibration-section">
    <div className="container">
      <div className="section-heading">
        <div><div className="kicker">RUNG 02D / EVIDENCE BRIDGE</div>
          <h2>Calibrate with local measurements</h2>
          <p>Use verified cold/warm experiment reports to replace synthetic model sizes and loading costs.</p>
        </div><div className="method-tag measure-tag">DERIVED • OFFLINE • NO MODEL CONTROL</div>
      </div>
      <div className="calibration-banner">
        <div className="calibration-banner-icon">Φ</div>
        <div><strong>Measured inputs are not measured policy wins.</strong>
          <p>Real Ollama cold-load timings and VRAM snapshots calibrate the model profiles. The arrival sequence is supplied by you. LRU and Φ still run as offline simulations, not on the physical GPU.</p>
        </div>
      </div>
      <div className="calibration-columns">
        <div className="calibration-sidebar">
          <div className="bar-heading"><span>01 / LOCAL INPUTS</span></div>
          <p className="calibration-help">Collect an R2B residency report for each installed model on the <em>same hardware</em> and with matching Ollama settings. Run only when the server is idle. Then choose all report files below.</p>
          <label className="import-button calibration-button">
            <input type="file" accept=".json,application/json" multiple onChange={receiveReports}/>
            SELECT R2B REPORT FILES <span>↗</span>
          </label>
          <div className="calibration-state">Loaded: <strong>{reports.length} source report(s)</strong></div>
          <div className="control-divider">02 / ARRIVAL SEQUENCE</div>
          <p className="calibration-help">Create a versioned JSON file listing the model names and request timestamps you'd like to simulate. The repository includes <code>examples/sample-arrivals.json</code> as a template.</p>
          <label className="import-button calibration-button">
            <input type="file" accept=".json,application/json" onChange={receiveArrivals}/>
            SELECT ARRIVAL SEQUENCE <span>↗</span>
          </label>
          <div className="calibration-state">Loaded: <strong>{arrivals?arrivals.requests.length+' requests':'No sequence yet'}</strong></div>
          <div className="control-divider">03 / MEMORY LIMIT</div>
          <label className="control"><div className="control-top"><span>GPU residency budget</span><strong>{display(budget)} GiB</strong></div>
            <input type="range" min="2" max="32" step=".5" value={budget} onChange={e=>setBudget(Number(e.target.value))}/>
          </label>
          {notice&&<p className="calibration-notice">{notice}</p>}
          {(error||calibrated.error)&&<p className="import-error" role="alert">{error||calibrated.error}</p>}
          <p className="fine">Files are read locally in browser memory. No API access, uploads, inferred personal workload history, or automatic model eviction.</p>
        </div>
        <div className="calibration-output">
          {calibrated.value&&comparison?<>
            <div className="panel-head"><span>04 / DERIVED MODEL PROFILES</span><span>{calibrated.value.trace.models.length} MODELS · {calibrated.value.trace.requests.length} ARRIVALS</span></div>
            <div className="calibration-table-scroll">
              <table className="calibration-table"><thead><tr><th>Model</th><th>Observed GPU footprint</th><th>Cold load median</th><th>Service-cost proxy</th></tr></thead>
              <tbody>{calibrated.value.trace.models.map(m=><tr key={m.id}>
                <td>{m.id}</td><td>{display(m.sizeGiB)} GiB</td><td>{display(m.loadMs,0)} ms</td><td>{display(m.inferMs,0)} ms</td>
              </tr>)}</tbody></table>
            </div>
            <div className="calibration-policies">
              {['none','lru','phi'].map(policy=><div key={policy} className={'calibration-policy '+policy}>
                <span>{policy==='phi'?'Φ WEIGHT BUBBLE':policy==='lru'?'STANDARD LRU':'NO CACHE'}</span>
                <strong>{display(comparison.runs[policy].stats.estimatedLoadMs/1000)} s</strong>
                <small>Simulated loading time · {comparison.runs[policy].stats.misses} misses</small>
              </div>)}
            </div>
            <div className="calibration-delta"><strong>{delta>=0?'+':'−'}{display(Math.abs(delta)/1000)} s</strong><span>{delta>=0?'Φ avoided more simulated loading than LRU':'LRU avoided more simulated loading than Φ'}</span></div>
            <div className="calibration-actions">
              <button className="btn export" onClick={()=>download('trace')}>EXPORT CALIBRATED R2C TRACE ↗</button>
              <button className="btn export" onClick={()=>download('report')}>EXPORT PROVENANCE REPORT ↗</button>
            </div>
            <div className="calibration-warnings"><strong>WHAT THIS DOES NOT PROVE</strong>
              {calibrated.value.caveats.map(c=><p key={c}>• {c}</p>)}
            </div>
          </>:<div className="calibration-empty">
              <div className="residency-orbit">Φ</div><h3>Awaiting measured profiles</h3>
              <p>Import two or more completed R2B reports and a local request sequence. The lab will check model identity, hardware, software version, contexts and warm/cold sample validity before constructing a calibrated trace.</p>
            </div>}
        </div>
      </div>
    </div>
  </section>;
}
