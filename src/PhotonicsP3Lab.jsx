import React, {useMemo, useState} from 'react';
import {parsePhotonicsP2, PHOTONICS_P2_MAX_BYTES} from './photonics-p2.js';
import {comparePhotonicsP2} from './photonics-p3.js';
import './photonics-hybrid.css';

export default function PhotonicsP3Lab() {
  const [files,setFiles]=useState([null,null]);
  const [error,setError]=useState('');
  const assessment=useMemo(()=>{
    if(!files[0] || !files[1]) return null;
    try {return {value:comparePhotonicsP2(files[0].report,files[1].report)};}
    catch(e){return {error:e.message};}
  },[files]);
  async function load(index,event){
    const file=event.target.files?.[0];
    event.target.value='';
    setError('');
    setFiles(prev=>prev.map((x,i)=>i===index?null:x));
    if(!file)return;
    if(file.size>PHOTONICS_P2_MAX_BYTES){
      setError('P2 reports must not exceed 256 KiB.');
      return;
    }
    try {
      const report=parsePhotonicsP2(await file.text());
      setFiles(prev=>prev.map((x,i)=>i===index
        ? {name:file.name,report}:x));
    }catch(e){setError(e?.message||'Unrecognized P2 report');}
  }
  return <section id="photonics-p3" className="hybrid-section">
    <div className="container">
      <div className="section-heading">
        <div>
          <div className="kicker">PHOTONICS P3 / REPEATABILITY GATE</div>
          <h2>Two-session evidence comparison</h2>
          <p>Did the same digital CPU/CUDA experiment behave similarly when repeated?</p>
        </div>
        <div className="method-tag">EXPLORATORY, NOT PHOTONIC PROOF</div>
      </div>
      <div className="hybrid-layout">
        <article className="hybrid-panel">
          <div className="panel-head"><span>01 / LOCAL REPORT PAIR</span></div>
          <p>Run the updated P2 script twice, ideally with other GPU-intensive applications closed. Keep the device, seed, workload parameters, PyTorch version and thread count unchanged. Store each report with a distinct filename.</p>
          <p>For example: <code>python scripts/photonics-p2.py --device cuda --repeats 6 --out benchmarks/p2-gpu-a.json</code> and repeat with <code>p2-gpu-b.json</code>.</p>
          {[0,1].map(i=><label className="hybrid-upload" key={i}>
            <strong>{i===0?'Session A':'Session B'} • {files[i]?.name || 'Select P2 JSON'}</strong>
            <input aria-label={'Load P2 session '+(i===0?'A':'B')}
              type="file" accept=".json,application/json" onChange={e=>load(i,e)}/>
            <small>Validated locally, not uploaded. Neither file authorizes model or hardware operations.</small>
          </label>)}
          {error && <p className="hybrid-error" role="alert">{error}</p>}
          {assessment?.error && <p className="hybrid-error" role="alert">{assessment.error}</p>}
        </article>
        <article className="hybrid-panel">
          <div className="panel-head"><span>02 / REPEATABILITY AUDIT</span>
            <span className="monospace">{assessment?.value?'TWO REPORTS CHECKED':'AWAITING MATCHED DATA'}</span></div>
          {!assessment?.value ? <div className="hybrid-empty">
            <strong>Nothing presumed.</strong>
            <p>Two separately generated reports are required. Incompatible parameters or hardware metadata produce a refusal rather than a misleading comparison.</p>
          </div> : <>
            <p className="hybrid-meta">Mode: {assessment.value.platform.device}
              {assessment.value.platform.gpu_name?' • '+assessment.value.platform.gpu_name:''}.
              {' '}{assessment.value.protocol.repeats_per_task} paired seeds per task.</p>
            <div className="hybrid-scroll">
              <table className="hybrid-table">
                <thead><tr>
                  <th scope="col">Task</th><th scope="col">Digital route</th>
                  <th scope="col">A / B median wall</th><th scope="col">B vs A time drift</th>
                  <th scope="col">Worst seed accuracy drift</th>
                </tr></thead>
                <tbody>{assessment.value.results.map(row=><tr key={row.task+row.method}>
                  <th scope="row">{row.task.replaceAll('_',' ')}</th><td>{row.method.replaceAll('_',' ')}</td>
                  <td>{row.session_a_median_ms.toFixed(2)} / {row.session_b_median_ms.toFixed(2)} ms</td>
                  <td>{row.median_timing_drift_percent===null?'N/A':
                    row.median_timing_drift_percent.toFixed(2)+'%'}
                    {row.flagged_for_review?' • Review':''}</td>
                  <td>{row.worst_seed_accuracy_drift_points.toFixed(2)} pp</td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="hybrid-meta">{assessment.value.warnings.length} method/task drift flags.
              Thresholds are screening heuristics, not pass/fail scientific tests.</p>
            <p className="hybrid-meta">Directional agreement in paired effects:
              {' '}{assessment.value.paired_effects.filter(x=>x.consistent_sign).length} of
              {' '}{assessment.value.paired_effects.length} comparisons.</p>
          </>}
          <p className="hybrid-verdict"><strong>Evidence status:</strong> exploratory two-session comparison. Matching JSON headers cannot prove machine identity or independent execution. This uses electronic computation, not physical photonic hardware.</p>
        </article>
      </div>
    </div>
  </section>;
}
