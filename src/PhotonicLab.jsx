import React, { useState } from 'react';
import { parsePhotonicsReport, PHOTONICS_MAX_BYTES, PHOTONICS_METHODS } from './photonics.js';
import './photonics.css';

const labels = {
  linear_input: 'Linear input',
  electronic_tanh: 'Electronic tanh reservoir',
  photonic_inspired_sine: 'Photonics-inspired sine delay'
};

const percent = n => (100 * n).toFixed(1) + '%';

export default function PhotonicLab() {
  const [report, setReport] = useState(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');

  async function load(event) {
    const file = event.target.files?.[0];
    setReport(null);
    setFilename('');
    setError('');
    event.target.value = '';
    if (!file) return;
    if (file.size > PHOTONICS_MAX_BYTES) {
      setError('Report exceeds the 256 KiB local import limit.');
      return;
    }
    try {
      const parsed = parsePhotonicsReport(await file.text());
      setReport(parsed);
      setFilename(file.name);
    } catch (failure) {
      setError(failure.message || 'Report rejected.');
    }
  }

  return <section id="photonics" className="photonics-section">
    <div className="container">
      <div className="section-heading">
        <div>
          <div className="kicker">RUNG P0 / OPTICAL RESEARCH</div>
          <h2>Photonics experiment bay</h2>
          <p>Same synthetic input. Three compute models. A report that refuses to call software an optical chip.</p>
        </div>
        <div className="method-tag">NUMERICAL SIMULATION ONLY</div>
      </div>
      <div className="photonics-layout">
        <article className="photonics-panel">
          <div className="panel-head"><span>01 / PIPELINE</span><span className="monospace">PYTORCH • OFFLINE</span></div>
          <div className="photonics-path">
            <span>Synthetic temporal XOR</span>
            <span className="photonics-arrow" aria-hidden="true">→</span>
            <span>Sine-delay / tanh / linear</span>
            <span className="photonics-arrow" aria-hidden="true">→</span>
            <span>Train-only ridge readout</span>
          </div>
          <p>Clone the repository and install PyTorch separately. Execute <code>python scripts/photonics-r0.py --device auto --out benchmarks/photonics-r0.json</code> after creating the output directory. CUDA is optional and will run <em>the simulation</em> on a GPU, not photons through hardware.</p>
          <p className="fine">This prototype does not implement the paper's state-skipping direct feedback alignment. It does not measure joules, physical fiber delay, model inference throughput, or any real optical advantage.</p>
          <label className="photonics-upload">
            <strong>Import a local results JSON</strong>
            <input aria-label="Import local photonics simulation JSON" type="file" accept=".json,application/json" onChange={load} />
            <small>Browser-only: no upload, credential access, or automatic agent actions.</small>
          </label>
          {error && <p className="photonics-error" role="alert">{error}</p>}
        </article>
        <article className="photonics-panel">
          <div className="panel-head"><span>02 / EVIDENCE</span><span className="monospace">{report ? 'LOCAL REPORT' : 'AWAITING REPORT'}</span></div>
          {!report ? <div className="photonics-empty">
            <strong>No fabricated benchmark numbers.</strong>
            <p>Import results produced on your own machine to show held-out test accuracy, numerical runtime, seeds, and device details.</p>
          </div> : <>
            <p className="photonics-meta">File: {filename} • {report.environment.device_name} ({report.environment.device}) • {report.protocol.repeats} repetitions</p>
            <div className="photonics-table-wrap">
              <table className="photonics-table">
                <thead><tr><th scope="col">Model</th><th scope="col">Mean held-out accuracy</th><th scope="col">Across seeds ± SD</th></tr></thead>
                <tbody>{PHOTONICS_METHODS.map(method =>
                  <tr key={method}><th scope="row">{labels[method]}</th>
                    <td>{percent(report.aggregate[method].mean_test_accuracy)}</td>
                    <td>{report.aggregate[method].sample_std_accuracy === null ?
                      '1 run' : percent(report.aggregate[method].sample_std_accuracy)}</td></tr>
                )}</tbody>
              </table>
            </div>
            <p className="fine">Dataset: {report.protocol.task}. {report.protocol.samples} samples, {report.protocol.steps} time steps, {report.protocol.virtual_nodes} virtual nodes. All timings are PyTorch host/GPU simulation timings.</p>
            <p className="photonics-verdict">Research boundary: <strong>digital simulation ≠ optical acceleration</strong>.</p>
          </>}
        </article>
      </div>
    </div>
  </section>;
}
