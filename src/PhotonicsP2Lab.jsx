import React, {useState} from 'react';
import {
  parsePhotonicsP2, PHOTONICS_P2_MAX_BYTES, PHOTONICS_P2_TASKS
} from './photonics-p2.js';
import './photonics-hybrid.css';

const taskNames = {
  temporal_xor: 'Temporal XOR (nonlinear)',
  first_pulse_memory: 'First-pulse memory (easier)'
};
const names = {
  cpu_sine:'CPU sine', cpu_tanh:'CPU tanh',
  cuda_sine:'CUDA sine', cuda_tanh:'CUDA tanh',
  hybrid_cuda_cpu_cuda_sine:'Hybrid GPU → CPU → GPU sine'
};

export default function PhotonicsP2Lab() {
  const [report,setReport] = useState(null);
  const [filename,setFilename] = useState('');
  const [error,setError] = useState('');
  async function load(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReport(null); setFilename(''); setError('');
    if(!file) return;
    if(file.size > PHOTONICS_P2_MAX_BYTES) {
      setError('P2 report exceeds local file limit (256 KiB).');
      return;
    }
    try {
      const parsed = parsePhotonicsP2(await file.text());
      setReport(parsed); setFilename(file.name);
    } catch (failure) {
      setError(failure?.message || 'Report rejected');
    }
  }
  return <section id="photonics-p2" className="hybrid-section">
    <div className="container">
      <div className="section-heading">
        <div>
          <div className="kicker">PHOTONICS P2 / VALIDATION</div>
          <h2>Controlled comparison lab</h2>
          <p>Two temporal tasks, randomized method order and paired exploratory uncertainty.</p>
        </div>
        <div className="method-tag">ELECTRONIC PYTORCH ONLY</div>
      </div>
      <div className="hybrid-layout">
        <article className="hybrid-panel">
          <div className="panel-head"><span>01 / MEASUREMENT PROTOCOL</span></div>
          <p>Every task/seed uses identical input samples, train/test split and model parameters across CPU/CUDA routes. Each route runs once as an unreported warm-up. Then method order is shuffled before timed trials.</p>
          <p>The runner records actual digital wall times, held-out accuracy, each path's timing and paired median timing differences with an exploratory bootstrap interval. The interval is <strong>not proof</strong> of a hardware advantage.</p>
          <p>After creating the <code>benchmarks</code> folder, execute <code>python scripts/photonics-p2.py --device auto --out benchmarks/photonics-p2.json</code> locally. CUDA is used only when available.</p>
          <label className="hybrid-upload">
            <strong>Import P2 report from this machine</strong>
            <input type="file" accept=".json,application/json"
              aria-label="Import Photonics P2 local report" onChange={load}/>
            <small>Read-only import. No upload, runtime calls or automatic ThinkTank decisions.</small>
          </label>
          {error && <p className="hybrid-error" role="alert">{error}</p>}
        </article>
        <article className="hybrid-panel">
          <div className="panel-head"><span>02 / PAIRED EVIDENCE</span><span className="monospace">{report ? 'LOCAL DIGITAL RESULT' : 'AWAITING FILE'}</span></div>
          {!report ? <div className="hybrid-empty"><strong>No measurements loaded.</strong>
            <p>We will not manufacture CPU, GPU, or optical performance results.</p></div> : <>
            <p className="hybrid-meta">{filename} • {report.environment.device === 'cuda'
              ? report.environment.gpu_name : 'CPU only'} • {report.protocol.repeats_per_task} paired seeds/task</p>
            {PHOTONICS_P2_TASKS.map(task => <div key={task}>
              <h3>{taskNames[task]}</h3>
              <div className="hybrid-scroll">
                <table className="hybrid-table"><thead><tr>
                  <th scope="col">Digital route</th><th scope="col">Held-out accuracy</th>
                  <th scope="col">Median wall</th>
                </tr></thead><tbody>
                {report.protocol.methods.map(method => <tr key={method}>
                  <th scope="row">{names[method]}</th>
                  <td>{(report.tasks[task].aggregate[method].mean_held_out_accuracy*100).toFixed(1)}%</td>
                  <td>{report.tasks[task].aggregate[method].median_wall_ms.toFixed(2)} ms</td>
                </tr>)}
                </tbody></table>
              </div>
              <p className="hybrid-meta"><strong>Paired differences:</strong> Positive values mean candidate slower. All intervals below are exploratory bootstrap estimates on digital PyTorch timing.</p>
              {report.tasks[task].paired_comparisons.map(pair =>
                <p key={pair.baseline+pair.candidate} className="hybrid-meta">
                  {names[pair.candidate]} vs {names[pair.baseline]}:
                  {' '}{pair.median_candidate_minus_baseline_ms.toFixed(2)} ms,
                  interval [{pair.exploratory_bootstrap_95pct_median_delta_ms[0].toFixed(2)},
                  {' '}{pair.exploratory_bootstrap_95pct_median_delta_ms[1].toFixed(2)}] ms
                </p>)}
            </div>)}
          </>}
          <p className="hybrid-verdict"><strong>Boundary:</strong> All P2 methods are electronic numerical computation. No photons, optical throughput, laser power, or measured energy savings are involved.</p>
        </article>
      </div>
    </div>
  </section>;
}
