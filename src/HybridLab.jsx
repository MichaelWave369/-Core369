import React, { useState } from 'react';
import {
  parseHybridReport, HYBRID_MAX_BYTES,
  HYBRID_CPU_METHODS, HYBRID_CUDA_METHODS
} from './photonics-hybrid.js';
import './photonics-hybrid.css';

const names = {
  cpu_sine: 'CPU / sine delay',
  cpu_tanh: 'CPU / tanh delay',
  cuda_sine: 'CUDA / sine delay',
  cuda_tanh: 'CUDA / tanh delay',
  hybrid_cuda_cpu_cuda_sine: 'GPU → CPU → GPU / sine delay'
};
const percent = x => (x * 100).toFixed(1) + '%';
const ms = x => Number.isFinite(x) ? x.toFixed(2) + ' ms' : 'Not measured';
const memory = bytes => bytes === null ? 'N/A' : (bytes / (1024 ** 2)).toFixed(2) + ' MiB';

export default function HybridLab() {
  const [report, setReport] = useState(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');

  async function load(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReport(null);
    setFilename('');
    setError('');
    if (!file) return;
    if (file.size > HYBRID_MAX_BYTES) {
      setError('P1 report exceeds the 256 KiB local import limit.');
      return;
    }
    try {
      const parsed = parseHybridReport(await file.text());
      setReport(parsed);
      setFilename(file.name);
    } catch (failure) {
      setError(failure?.message || 'Invalid P1 report');
    }
  }

  const methods = report
    ? [...HYBRID_CPU_METHODS, ...(report.environment.device === 'cuda'
      ? HYBRID_CUDA_METHODS : [])] : [];

  return <section id="hybrid" className="hybrid-section">
    <div className="container">
      <div className="section-heading">
        <div>
          <div className="kicker">PHOTONICS P1 / DIGITAL HYBRID ROUTING</div>
          <h2>Hybrid compute experiment</h2>
          <p>Measure what happens when a photonics-inspired digital reservoir moves between CPU and GPU stages.</p>
        </div>
        <div className="method-tag">NOT OPTICAL HARDWARE</div>
      </div>
      <div className="hybrid-layout">
        <article className="hybrid-panel">
          <div className="panel-head"><span>01 / PATHS</span><span className="monospace">CONTROLLED TOY TASK</span></div>
          <div className="hybrid-route"><span>CPU</span><b>Preprocess</b><b>Reservoir</b><b>Readout</b></div>
          <div className="hybrid-route"><span>CUDA</span><b>Preprocess</b><b>Reservoir</b><b>Readout</b></div>
          <div className="hybrid-route"><span>HYBRID</span><b>GPU preprocess</b><b>CPU sine</b><b>GPU readout</b></div>
          <p>All three routes execute numerical PyTorch operators. The mixed route's middle CPU stage is only a <strong>placeholder for a possible future optical accelerator</strong>. This benchmark measures transfer overhead and feature agreement, not future photonic performance.</p>
          <p>Run <code>python scripts/photonics-p1.py --device auto --out benchmarks/photonics-p1.json</code> from a local clone after creating the <code>benchmarks</code> directory. The output is new-file-only and stays on your computer until you choose it here.</p>
          <label className="hybrid-upload">
            <strong>Import local P1 results</strong>
            <input type="file" accept=".json,application/json" aria-label="Import hybrid compute P1 report" onChange={load}/>
            <small>Browser-local. No cloud upload, live hardware control or automatic ThinkTank actions.</small>
          </label>
          {error && <p className="hybrid-error" role="alert">{error}</p>}
        </article>
        <article className="hybrid-panel">
          <div className="panel-head"><span>02 / RESULTS</span><span className="monospace">{report ? 'LOCALLY IMPORTED' : 'NO REPORT'}</span></div>
          {!report ? <div className="hybrid-empty"><strong>Awaiting measured numerical results.</strong>
            <p>No bundled demo speeds, imaginary energy savings, or assumed GPU specifications.</p></div> : <>
            <p className="hybrid-meta">{filename} • {report.environment.device === 'cuda'
              ? report.environment.gpu_name : 'CPU-only run'} • {report.protocol.repeats} seeds</p>
            <div className="hybrid-scroll">
              <table className="hybrid-table">
                <thead><tr><th scope="col">Path</th><th scope="col">Held-out accuracy</th>
                  <th scope="col">Median wall time</th><th scope="col">GPU peak delta*</th></tr></thead>
                <tbody>{methods.map(method => <tr key={method}>
                  <th scope="row">{names[method]}</th>
                  <td>{percent(report.aggregate[method].mean_held_out_accuracy)}</td>
                  <td>{ms(report.aggregate[method].median_wall_ms)}</td>
                  <td>{memory(report.aggregate[method].median_peak_incremental_cuda_allocated_bytes)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {report.environment.device === 'cpu' &&
              <p className="hybrid-meta">CUDA methods were skipped. No GPU timings were inferred or simulated.</p>}
            <p className="hybrid-meta">*Peak additional PyTorch tensor allocations, not total GPU usage. The numerical input/output transfers, method-order effects, and cold kernel startup limit timing comparisons.</p>
          </>}
          <p className="hybrid-verdict"><strong>Interpretation:</strong> These timings describe digital CPU/CUDA partitions only. A future optical accelerator would require its own latency, correctness, bandwidth and joule measurements before performance conclusions.</p>
        </article>
      </div>
    </div>
  </section>;
}
