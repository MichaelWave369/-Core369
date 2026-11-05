import React, { useMemo, useState } from 'react';
import { summarizeResidency, validateResidencyReport } from './residency.js';

const format = (value, places = 2) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: places }) : '—';

function ResidencyMetric({ label, value, unit, caption }) {
  return <div className="residency-metric">
    <div className="eyebrow">{label}</div>
    <div className="residency-number">{format(value)}<small> {unit}</small></div>
    <div className="residency-caption">{caption}</div>
  </div>;
}

function TrialChart({ report }) {
  const width = 680, height = 220;
  const paired = summarizeResidency(report).paired;
  if (!paired.length) return <p className="fine">No successful cold/warm pairs to plot.</p>;
  const values = paired.flatMap(p => [p.coldTtftMs, p.warmTtftMs]);
  const maxY = Math.max(50, ...values) * 1.12;
  const x = index => 55 + index * (width - 85) / Math.max(1, paired.length - 1);
  const y = value => 10 + (height - 45) * (1 - value / maxY);
  const series = (key, color) => <>
    <path d={paired.map((p, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(p[key])).join(' ')} fill="none" stroke={color} strokeWidth="2.5" />
    {paired.map((p, i) => <circle key={i} cx={x(i)} cy={y(p[key])} r="4.5" fill={color}><title>Pair {p.pair}: {format(p[key])} ms</title></circle>)}
  </>;
  return <div className="residency-chart">
    <div className="bar-heading"><span>Paired client-observed first-text latency</span><span className="muted">Milliseconds • lower is faster</span></div>
    <div className="residency-legend"><span><i className="cold-dot"></i> Cold</span><span><i className="warm-dot"></i> Preloaded</span></div>
    <svg role="img" aria-label="Paired cold versus preloaded first text latencies in milliseconds" viewBox={'0 0 ' + width + ' ' + height}>
      {[0, .5, 1].map(f => <g key={f}>
        <line x1="55" x2={width - 30} y1={y(f * maxY)} y2={y(f * maxY)} stroke="#395269" strokeDasharray="4 5" />
        <text x="45" y={y(f * maxY) + 4} textAnchor="end" fill="#8eafbd" fontSize="11">{format(f * maxY, 0)}</text>
      </g>)}
      {series('coldTtftMs', '#ecae83')}
      {series('warmTtftMs', '#83eacb')}
      {paired.map((p, i) => <text key={p.pair} x={x(i)} y={height - 7} textAnchor="middle" fill="#9eb6c4" fontSize="11">{p.pair}</text>)}
    </svg>
    <p className="fine">Only successful matched prompt pairs are plotted. Order is seeded; system temperature, page caches and background load may still influence outcomes.</p>
  </div>;
}

export default function ResidencyLab() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const data = useMemo(() => report ? summarizeResidency(report) : null, [report]);
  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error('JSON report exceeds the 2 MB safety limit');
      const parsed = validateResidencyReport(JSON.parse(await file.text()));
      setReport(parsed);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report could not be read');
    }
  }
  return <section id="residency" className="residency-section">
    <div className="container">
      <div className="section-heading">
        <div><div className="kicker">RUNG 02B / WEIGHT-BUBBLE EXPERIMENT 01</div>
          <h2>Residency crossover lab</h2>
          <p>Control Ollama model preloading and measure what it actually changes.</p>
        </div><div className="method-tag measure-tag">REAL API / OPT-IN</div>
      </div>
      <div className="residency-layout">
        <div className="residency-setup">
          <div className="bar-heading"><span>THE EXPERIMENT</span><span className="muted">Local-only</span></div>
          <p>Compare the same model and prompt under two conditions: <strong>cold</strong> (explicit unload before generation) and <strong>preloaded</strong> (load into Ollama memory before generation). Both conditions run in randomized order within each pair.</p>
          <div className="residency-command">
            <div className="eyebrow">Step 01 • Inspect the current Ollama server</div>
            <code>node scripts/residency-bench.mjs --model qwen3:4b</code>
          </div>
          <div className="residency-command">
            <div className="eyebrow">Step 02 • Run explicitly, when safe</div>
            <code>node scripts/residency-bench.mjs --model qwen3:4b --pairs 6 --execute</code>
          </div>
          <p className="fine">Run these from your local clone, replacing the model with one from <code>ollama list</code>. Without <code>--execute</code>, the tool only inspects. By default it refuses to run if Ollama has loaded models. Running will interrupt and unload the named model; do this when other sessions are idle. Ollama may evict additional models to make space.</p>
          <div className="residency-upload">
            <strong>Step 03 • Import local results</strong>
            <label className="import-button"><input type="file" accept="application/json,.json" onChange={handleFile} />{report ? 'REPLACE RESIDENCY REPORT' : 'IMPORT RESIDENCY JSON'} <span>↗</span></label>
            {error && <p className="import-error" role="alert">{error}</p>}
            {report && <div className="fine">{report.manifest.model} • {report.manifest.pairs} pairs • Ollama {report.manifest.backendVersion}
              <button className="text-btn residency-clear" onClick={() => { setReport(null); setError(''); }}>CLEAR</button>
            </div>}
          </div>
        </div>
        <div className="residency-results">
          {!data
            ? <div className="residency-placeholder"><div className="residency-orbit">Φ</div>
                <h3>Awaiting real experiments</h3>
                <p>Run the local crossover first. This panel will compare actual Ollama timings without showing invented speedups or requesting access to your computer.</p>
              </div>
            : <>
              <div className="panel-head"><span>OBSERVED MEASUREMENTS</span><span>{data.enoughPairs ? 'COMPLETE PAIRS' : 'INCOMPLETE / EXPLORATORY'}</span></div>
              <div className="residency-metrics">
                <ResidencyMetric label="Cold first text" value={data.cold.ttftMedianMs} unit="ms" caption="Request-to-first-text median" />
                <ResidencyMetric label="Preloaded first text" value={data.preloaded.ttftMedianMs} unit="ms" caption="After explicit preload" />
                <ResidencyMetric label="Median paired difference" value={data.ttftSavedMedianMs} unit="ms" caption="Positive means warm was faster" />
                <ResidencyMetric label="Preload overhead" value={data.preloaded.preloadMedianMs} unit="ms" caption="Time paid before user request" />
              </div>
              <TrialChart report={report} />
              <div className="residency-breakdown">
                <div className="bar-heading"><span>Latency accounting</span><span className="muted">Do not confuse time-shifting with saving work</span></div>
                <table>
                  <thead><tr><th>Median metric</th><th>Cold</th><th>Preloaded</th></tr></thead>
                  <tbody>
                    <tr><td>Engine request duration</td><td>{format(data.cold.engineLatencyMedianSec)} s</td><td>{format(data.preloaded.engineLatencyMedianSec)} s</td></tr>
                    <tr><td>Engine load portion</td><td>{format(data.cold.loadMedianSec)} s</td><td>{format(data.preloaded.loadMedianSec)} s</td></tr>
                    <tr><td>Request + preloading</td><td>{format(data.cold.totalIncludingPreloadMedianSec)} s</td><td>{format(data.preloaded.totalIncludingPreloadMedianSec)} s</td></tr>
                    <tr><td>Reported VRAM residency</td><td>Not sampled</td><td>{format(data.preloaded.sizeVramMedianGiB)} GiB</td></tr>
                    <tr><td>Valid / attempted</td><td>{data.cold.successful} / {data.cold.attempted}</td><td>{data.preloaded.successful} / {data.preloaded.attempted}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="residency-caveat"><strong>INTERPRETATION</strong><p>{data.caveat}</p>
                {report.manifest.initialLoadedModels > 0 && <p>This trial began with {report.manifest.initialLoadedModels} already resident model(s), which can confound results.</p>}
                {!data.enoughPairs && <p>Insufficient clean pairs for a complete comparison. Failures must remain visible.</p>}
              </div>
            </>}
        </div>
      </div>
    </div>
  </section>;
}
