import React, { useMemo, useState } from 'react';
import { compareReports, summarize, validateReport } from './measurements.js';

const fmt = (n, digits = 2) => n == null || !Number.isFinite(n) ? '—' :
  n.toLocaleString('en-US', { maximumFractionDigits: digits });
const stamp = value => typeof value === 'string' ? value.slice(0, 19).replace('T', ' ') + ' UTC' : '—';

function RunGraph({ report }) {
  const entries = report.runs.filter(r => r.ok);
  const width = 540, height = 166, left = 37, right = 15, top = 15, bottom = 24;
  const max = Math.max(1, ...entries.map(r => r.decodeTokensPerSec)) * 1.15;
  const x = i => left + (entries.length <= 1 ? 0 : i / (entries.length - 1) * (width - left - right));
  const y = value => top + (height - top - bottom) * (1 - value / max);
  const path = entries.map((entry, index) =>
    (index === 0 ? 'M' : 'L') + x(index) + ' ' + y(entry.decodeTokensPerSec)).join(' ');
  return <div className="measure-graph">
    <div className="bar-heading"><span>Per-run decode rate</span><span className="muted">Ollama-reported timing</span></div>
    <svg role="img" aria-label="Measured decode tokens per second by run" viewBox={'0 0 ' + width + ' ' + height}>
      {[0, .5, 1].map(tick => <g key={tick}>
        <line x1={left} x2={width - right} y1={y(tick * max)} y2={y(tick * max)} stroke="#345064" strokeDasharray="4 6" />
        <text x={left - 7} y={y(tick * max) + 4} fill="#9cb6c8" textAnchor="end" fontSize="11">{fmt(tick * max, 0)}</text>
      </g>)}
      {entries.length > 1 && <path d={path} fill="none" stroke="#80edd0" strokeWidth="3" />}
      {entries.map((run, i) => <g key={run.sequence}>
        <circle cx={x(i)} cy={y(run.decodeTokensPerSec)} r="4.5" fill="#a3ffe5" />
        <title>Run {run.sequence}: {fmt(run.decodeTokensPerSec)} tok/s</title>
      </g>)}
      <text x={left} y={height - 6} fill="#829cad" fontSize="11">1</text>
      <text x={width - right} y={height - 6} textAnchor="end" fill="#829cad" fontSize="11">{entries.length} successful</text>
    </svg>
  </div>;
}

function Stat({ label, value, unit, caption }) {
  return <div className="measure-stat">
    <div className="eyebrow">{label}</div><div className="measure-stat-value">{value}<small>{unit}</small></div><span>{caption}</span>
  </div>;
}

function ImportSlot({ title, report, onImport, onClear }) {
  const [error, setError] = useState('');
  const handle = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      if (file.size > 2_000_000) throw new Error('File exceeds the 2 MB limit');
      const parsed = JSON.parse(await file.text());
      const valid = validateReport(parsed);
      onImport(valid);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot read report');
    }
  };
  return <div className="import-slot">
    <div className="import-head"><strong>{title}</strong>{report && <button onClick={onClear} className="text-btn">CLEAR</button>}</div>
    {report
      ? <><div className="import-status"><i></i> LOCAL MEASUREMENT REPORT LOADED</div>
        <strong className="import-model">{report.manifest.model}</strong>
        <div className="fine">Digest: {report.manifest.modelDigest.slice(0, 14)}…</div>
        <div className="fine">{report.runs.length} attempted runs · {stamp(report.manifest.utc)}</div>
      </>
      : <div className="import-placeholder">No report imported yet. Run the local collector first.</div>}
    <label className="import-button">
      <input type="file" accept=".json,application/json" onChange={handle} />
      {report ? 'REPLACE REPORT' : 'CHOOSE JSON REPORT'} <span>↗</span>
    </label>
    {error && <p role="alert" className="import-error">{error}</p>}
  </div>;
}

export default function MeasuredLab() {
  const [baseline, setBaseline] = useState(null);
  const [repeat, setRepeat] = useState(null);
  const summary = useMemo(() => baseline ? summarize(baseline) : null, [baseline]);
  const comparison = useMemo(() => baseline && repeat ? compareReports(baseline, repeat) : null, [baseline, repeat]);
  const reportForChart = baseline || repeat;
  const chartStats = useMemo(() => reportForChart ? summarize(reportForChart) : null, [reportForChart]);

  return <section className="measurement-section" id="measurements">
    <div className="container">
      <div className="section-heading">
        <div><div className="kicker">RUNG 02 / REAL-WORLD INFERENCE</div>
          <h2>The Measurement Engine</h2>
          <p>Bring local Ollama timing data into the lab. No cloud benchmark service required.</p>
        </div><div className="method-tag measure-tag">IMPORTED MEASUREMENTS / R2A</div>
      </div>
      <div className="measure-banner">
        <div className="measure-banner-icon">02</div>
        <div><strong>Measure first. Optimize second.</strong>
          <p>This GitHub Pages site never connects to your Ollama instance. The benchmark runner executes locally, saves JSON on your PC, and only the file you choose is analyzed here. No uploads or remote storage.</p>
        </div>
      </div>
      <div className="measure-instructions">
        <div className="bar-heading"><span>01 / Collect a real baseline on your computer</span><span className="muted">Node 22 + running Ollama</span></div>
        <p>Clone this repository, open a terminal in its directory, then run:</p>
        <pre><code>node scripts/ollama-bench.mjs --model qwen3:4b --runs 6 --out benchmarks/local-baseline.json</code></pre>
        <p className="fine">Change the model to one shown by <code>ollama list</code>. The runner performs a warmup and six streamed generations over three fixed prompts. No generated text is saved. Command runs on your own machine, not in this browser.</p>
      </div>
      <div className="measure-imports">
        <ImportSlot title="02 / BASELINE REPORT" report={baseline} onImport={setBaseline} onClear={() => setBaseline(null)} />
        <ImportSlot title="03 / REPEAT REPORT" report={repeat} onImport={setRepeat} onClear={() => setRepeat(null)} />
      </div>
      {reportForChart ? <>
        <div className="measurement-panel">
          <div className="panel-head"><span>04 / MEASURED RESULTS</span><span>USER-IMPORTED DATA · NOT INDEPENDENTLY VERIFIED</span></div>
          <div className="measurement-metrics">
            <Stat label="Median decode" value={fmt(chartStats.decodeMedian)} unit="tok/s" caption="Engine eval_count / eval_duration" />
            <Stat label="Median prefill" value={fmt(chartStats.promptMedian)} unit="tok/s" caption="Engine prompt_eval timings" />
            <Stat label="Client first token" value={fmt(chartStats.ttftMedianMs)} unit="ms" caption="From HTTP request to first text chunk" />
            <Stat label="Valid runs" value={String(chartStats.successful) + ' / ' + chartStats.total} unit="" caption={chartStats.failures ? 'Includes failed attempts' : 'No failures reported'} />
          </div>
          <div className="measure-split">
            <RunGraph report={reportForChart} />
            <div className="measure-meta">
              <div className="bar-heading"><span>Run provenance</span></div>
              <dl>
                <dt>Model</dt><dd>{reportForChart.manifest.model}</dd>
                <dt>Backend</dt><dd>Ollama {reportForChart.manifest.backendVersion}</dd>
                <dt>Host</dt><dd>{reportForChart.manifest.hardware.os}</dd>
                <dt>CPU</dt><dd>{reportForChart.manifest.hardware.cpu}</dd>
                <dt>GPU</dt><dd>{reportForChart.manifest.hardware.gpu?.name || 'Not recorded'}</dd>
                <dt>Context</dt><dd>{reportForChart.manifest.options.num_ctx} requested tokens</dd>
              </dl>
            </div>
          </div>
          <div className="measure-prompts">
            <div className="bar-heading"><span>Prompt-level medians</span><span className="muted">Helps identify workload variation</span></div>
            <table><thead><tr><th>Workload</th><th>Successful runs</th><th>Median decode</th></tr></thead>
              <tbody>{chartStats.byPrompt.map(p => <tr key={p.promptId}><td>{p.promptId}</td><td>{p.count}</td><td>{fmt(p.decodeMedian)} tok/s</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </> : <div className="measure-empty"><div className="empty-mark">Φ</div><h3>No measured runs yet</h3><p>Import a JSON report from the local runner. The dashboard will show real Ollama timings separately from the Rung 1 theoretical simulator.</p></div>}

      {comparison && <div className="measure-compare">
        <div className="bar-heading"><span>05 / CONTROLLED REPEAT COMPARISON</span>
          <span className={'hypothesis-tag ' + (comparison.compatible ? '' : 'not-compatible')}>
            {comparison.compatible ? 'COMPARABLE CONDITIONS' : 'NOT COMPARABLE'}
          </span></div>
        {comparison.compatible
          ? <div className="compare-grid">
            <div><small>First import median</small><strong>{fmt(comparison.baseline.decodeMedian)} <span>tok/s</span></strong></div>
            <div><small>Second import median</small><strong>{fmt(comparison.repeat.decodeMedian)} <span>tok/s</span></strong></div>
            <div><small>Repeat variation</small><strong>{comparison.deltaPercent >= 0 ? '+' : ''}{fmt(comparison.deltaPercent)}<span>%</span></strong></div>
          </div>
          : <p className="comparison-warning">Comparison blocked: {comparison.mismatches.join('; ')}. Keep hardware, exact model digest, prompts, options, and runtime version identical.</p>}
        <p className="fine">A change between repeated runs does not demonstrate an optimization. This tool does not validate output quality, thermals, energy or GPU memory placement. A future weight-bubble variant needs a documented experimental change and independent quality checks.</p>
      </div>}
    </div>
  </section>;
}
