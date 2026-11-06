import React, { useMemo, useState } from 'react';
import { analyze, contextSweep, defaults, kvCompressionScenario, presets } from './model.js';
import MeasuredLab from './MeasuredLab.jsx';
import ResidencyLab from './ResidencyLab.jsx';
import WeightBubbleLab from './WeightBubbleLab.jsx';
import CalibrationLab from './CalibrationLab.jsx';
import PhotonicLab from './PhotonicLab.jsx';

const rounded = (n, decimals = 1) => Number.isFinite(n)
  ? n.toLocaleString('en-US', { maximumFractionDigits: decimals })
  : '—';
const tpsText = n => n == null ? 'N/A' : rounded(n, 1);
const limitNames = { compute: 'Compute', memory: 'Memory bandwidth', link: 'Interconnect' };

function Metric({ label, value, unit, sub, accent }) {
  return <div className={'metric ' + (accent ? 'metric-accent' : '')}>
    <div className="eyebrow">{label}</div>
    <div className="metric-value">{value}<span>{unit}</span></div>
    <p>{sub}</p>
  </div>;
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange, note }) {
  return <label className="control">
    <div className="control-top"><span>{label}</span><strong>{rounded(value, 2)} {unit}</strong></div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))} />
    {note && <small>{note}</small>}
  </label>;
}

function MemoryBar({ results }) {
  const capacity = results.settings.vramGiB;
  const displayTotal = Math.max(capacity, results.workingSetGiB);
  const portions = [
    ['weights', results.residentGiB, 'Resident weights'],
    ['kv', results.kvGiB, 'KV cache'],
    ['reserve', results.settings.reserveGiB, 'Reserved'],
    ['offload', results.offloadedGiB, 'Offloaded weights']
  ];
  return <div className="memory-visual">
    <div className="bar-heading"><span>Memory allocation</span><strong>{rounded(results.workingSetGiB, 2)} GiB required</strong></div>
    <div className="memory-track">
      {portions.map(([kind, amount, label]) =>
        <div key={kind} className={'segment ' + kind} title={label + ': ' + rounded(amount, 2) + ' GiB'}
          style={{ width: (amount / displayTotal * 100) + '%' }} />
      )}
      <div className="capacity-mark" style={{ left: (Math.min(capacity / displayTotal, 1) * 100) + '%' }} />
    </div>
    <div className="bar-scale"><span>0 GiB</span><span>Accelerator capacity: {rounded(capacity)} GiB</span></div>
    <div className="legend">
      {portions.map(([kind, amount, label]) =>
        <div key={kind}><i className={'swatch ' + kind}></i>{label}<strong>{rounded(amount, 2)} GiB</strong></div>
      )}
    </div>
  </div>;
}

function Curve({ settings }) {
  const data = useMemo(() => contextSweep(settings), [settings]);
  const width = 680, height = 215, margin = { left: 46, right: 14, top: 15, bottom: 31 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const yTop = Math.max(1, ...data.map(d => d.tokensPerSecondCeiling ?? 0)) * 1.12;
  const X = i => margin.left + i / Math.max(1, data.length - 1) * plotW;
  const Y = v => margin.top + plotH - v / yTop * plotH;
  const valid = data.map((d, i) => ({ i, y: d.tokensPerSecondCeiling })).filter(p => p.y != null);
  const path = valid.map((p, index) => (index ? 'L' : 'M') + X(p.i).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  const topLine = (Math.round(yTop / 2 * 10) / 10);
  return <div className="curve" aria-label="Modeled token throughput upper-bound versus context length">
    <div className="bar-heading"><span>Context pressure</span><span className="muted">Analytical ceilings, not benchmarks</span></div>
    <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Throughput ceiling falls as context grows or memory overflows">
      {[0, .5, 1].map(frac => <g key={frac}>
        <line x1={margin.left} x2={width - margin.right} y1={Y(yTop * frac)} y2={Y(yTop * frac)} stroke="#27374b" strokeDasharray="4 6" />
        <text x={margin.left - 9} y={Y(yTop * frac) + 4} textAnchor="end" fill="#8da4bd" fontSize="11">{rounded(yTop * frac, 0)}</text>
      </g>)}
      {path && <path d={path} fill="none" stroke="#74e9c5" strokeWidth="3" strokeLinejoin="round" />}
      {valid.map(p => <circle key={p.i} cx={X(p.i)} cy={Y(p.y)} r="4" fill="#a1ffe0" />)}
      {data.map((d, i) => <text key={d.contextTokens} x={X(i)} y={height - 9} textAnchor="middle" fill="#8da4bd" fontSize="11">{d.contextTokens >= 1024 ? (d.contextTokens / 1024) + 'k' : d.contextTokens}</text>)}
      <text x="10" y="13" fill="#8da4bd" fontSize="10">tok/s</text>
      {data.filter(d => !d.kvFits).map(d => <text key={'x' + d.contextTokens}
        x={X(data.findIndex(p => p.contextTokens === d.contextTokens))}
        y={height / 2} textAnchor="middle" fill="#f3a786" fontSize="18">×</text>)}
    </svg>
    <p className="fine">Crosses indicate a KV capacity failure. Values assume one decode stream, simplified weight traffic, and fixed efficiency.</p>
  </div>;
}

function Schematic() {
  return <div className="schematic">
    <div className="schematic-glow" aria-hidden="true"></div>
    <div className="schematic-header"><span className="signal"></span> CONCEPT • RUNG 1</div>
    <div className="chip chip-top"><span>INTELLIGENCE PLANE</span><strong>Models / Agents / Context</strong></div>
    <div className="connector-line"><i></i><i></i><i></i></div>
    <div className="chip chip-center"><span>Φ WEIGHT BUBBLE</span><strong>Memory placement & scheduling</strong><small>Hypothesis • not implemented in hardware</small></div>
    <div className="connector-line"><i></i><i></i><i></i></div>
    <div className="chip-grid">
      <div className="chip"><span>COMPUTE</span><strong>Matrix / SIMD</strong></div>
      <div className="chip"><span>MEMORY</span><strong>Fast / Capacity</strong></div>
      <div className="chip"><span>FABRIC</span><strong>Links / I/O</strong></div>
    </div>
    <div className="chip-foot">ΦOS SUBSTRATE <span>Runtime • telemetry • isolation</span></div>
  </div>;
}

export default function App() {
  const [settings, setSettings] = useState({ ...defaults });
  const [presetId, setPresetId] = useState('edge');
  const [copied, setCopied] = useState(false);
  const results = useMemo(() => analyze(settings), [settings]);
  const comparison = useMemo(() => kvCompressionScenario(settings), [settings]);
  const change = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setCopied(false);
  };
  const choose = id => {
    setPresetId(id);
    setSettings(prev => ({ ...prev, ...Object.fromEntries(
      ['parametersB', 'activeRatio', 'layers', 'kvHeads', 'headDim'].map(k => [k, presets[id][k]])
    ) }));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ model: 'ΦCore369 R1', settings: results.settings, analysis: results }, null, 2));
      setCopied(true);
    } catch { setCopied(false); }
  };

  return <div className="app">
    <div className="ambient ambient-a"></div><div className="ambient ambient-b"></div>
    <header className="site-header container">
      <a href="#top" className="brand"><div className="brand-mark">Φ</div><div><strong>CORE<span>369</span></strong><small>MEMORY-FIRST COMPUTE LAB</small></div></a>
      <nav><a href="#laboratory">Simulator</a><a href="#measurements">Measurements</a><a href="#residency">Residency</a><a href="#bubble">Weight Bubble</a><a href="#calibration">Calibration</a><a href="#photonics">Photonics</a><a href="#architecture">Architecture</a><a href="https://github.com/MichaelWave369/-Core369" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
      <div className="live-pill"><i></i> OPEN RESEARCH / R2D</div>
    </header>
    <main id="top">
      <section className="hero container">
        <div>
          <div className="kicker"><span className="dash"></span> Φ369 LABS • ARCHITECTURE PROGRAM</div>
          <h1>Stop squeezing intelligence into yesterday's <em>hardware.</em></h1>
          <p className="hero-copy">What happens when we design compute around the flow of model weights, context, and memory bandwidth? Start with physics. Model the bottlenecks. Build what the evidence supports.</p>
          <div className="hero-buttons"><a className="btn primary" href="#laboratory">Enter the lab <span>↗</span></a><a className="btn subtle" href="#architecture">Explore the blueprint</a></div>
          <div className="hero-notice"><span>01</span><div><strong>No manufactured chip. No claimed speedup.</strong><small>This is a transparent analytical prototype, not a measured inference benchmark.</small></div></div>
        </div>
        <Schematic />
      </section>

      <section id="laboratory" className="lab-section">
        <div className="container">
          <div className="section-heading"><div><div className="kicker">RUNG 01 / LIVE MODEL</div><h2>Inference constraint laboratory</h2><p>Change the assumptions. Watch the theoretical bottleneck move.</p></div><div className="method-tag">ROOFLINE MODEL v0.1</div></div>
          <div className="lab-grid">
            <aside className="controls-panel">
              <div className="panel-head"><span>01 / SCENARIO</span><button className="text-btn" onClick={() => { setPresetId('edge'); setSettings({ ...defaults }); }}>RESET</button></div>
              <div className="preset-grid">{Object.entries(presets).map(([id, p]) =>
                <button key={id} className={'preset ' + (presetId === id ? 'selected' : '')} onClick={() => choose(id)}><strong>{p.name}</strong><small>{p.detail}</small></button>
              )}</div>
              <div className="control-divider">MODEL & CONTEXT</div>
              <Slider label="Weight precision" value={settings.weightBits} min={2} max={16} step={2} unit="bits" onChange={v => change('weightBits', v)} />
              <Slider label="Context length" value={settings.contextTokens} min={2048} max={131072} step={2048} unit="tokens" onChange={v => change('contextTokens', v)} />
              <Slider label="Concurrent KV sessions" value={settings.sessions} min={1} max={8} unit="" onChange={v => change('sessions', v)} />
              <Slider label="KV cache precision" value={settings.kvBits} min={4} max={16} step={4} unit="bits" onChange={v => change('kvBits', v)} />
              <div className="control-divider">HARDWARE ASSUMPTIONS</div>
              <Slider label="Accelerator memory" value={settings.vramGiB} min={4} max={128} step={4} unit="GiB" onChange={v => change('vramGiB', v)} />
              <Slider label="Memory bandwidth" value={settings.bandwidthGiBs} min={50} max={4000} step={50} unit="GiB/s" onChange={v => change('bandwidthGiBs', v)} />
              <Slider label="Host interconnect" value={settings.linkGiBs} min={4} max={128} step={4} unit="GiB/s" onChange={v => change('linkGiBs', v)} />
              <Slider label="Effective peak compute" value={settings.computeTflops} min={10} max={500} step={10} unit="TFLOP/s" onChange={v => change('computeTflops', v)} note="Modeled low-precision peak; not device specifications." />
              <Slider label="Utilization assumption" value={settings.efficiency * 100} min={10} max={100} step={5} unit="%" onChange={v => change('efficiency', v / 100)} />
              <button className="btn export" onClick={copy}>{copied ? '✓ COPIED SCENARIO' : 'COPY MODEL DATA ↗'}</button>
            </aside>

            <div className="result-panel">
              <div className="panel-head"><span>02 / ANALYSIS</span><span className="monospace">STATUS: {results.kvFits ? 'MODELED' : 'CAPACITY FAILURE'}</span></div>
              <div className="metric-grid">
                <Metric label="Working set" value={rounded(results.workingSetGiB, 2)} unit="GiB" sub="Weights + all KV sessions + reserve" accent />
                <Metric label="GPU-resident weights" value={rounded(results.residentGiB, 2)} unit="GiB" sub="Fits after KV and reserve" />
                <Metric label="Host-offloaded weights" value={rounded(results.offloadedGiB, 2)} unit="GiB" sub="Requires additional host memory" />
                <Metric label="Decode ceiling" value={tpsText(results.tokensPerSecondCeiling)} unit="tok/s" sub={results.kvFits ? 'Simplified model upper bound' : 'KV exceeds accelerator capacity'} />
              </div>
              <div className="result-section"><MemoryBar results={results} /></div>
              <div className="result-section">
                <div className="bar-heading"><span>Bottleneck diagnostics</span><strong>{results.kvFits ? limitNames[results.limitingFactor] + ' limited' : 'Invalid capacity'}</strong></div>
                <div className="limits">
                  {Object.entries(results.ceilings).map(([key, val]) => <div className="limit" key={key}><span>{limitNames[key]}</span><div className="mini-track"><div style={{ width: Math.min(100, (results.tokensPerSecondCeiling ?? 0) / (Number.isFinite(val) ? val : 1e9) * 100) + '%' }}></div></div><strong>{Number.isFinite(val) ? rounded(val) : '∞'} tok/s</strong></div>)}
                </div>
                <p className="fine">Each value is a separate optimistic ceiling; the lowest one dominates. Graph bars show the current limiting ceiling as a fraction of each constraint.</p>
              </div>
              <div className="result-section"><Curve settings={settings} /></div>
              <div className="hypothesis">
                <div className="bar-heading"><span>EXPERIMENT A • KV CACHE COMPRESSION</span><span className="hypothesis-tag">MODELED HYPOTHESIS</span></div>
                <div className="comparison">
                  <div><small>Current precision</small><strong>{settings.kvBits} bit</strong><span>{tpsText(comparison.baseline.tokensPerSecondCeiling)} tok/s ceiling</span></div>
                  <div className="arrow">→</div>
                  <div><small>Half-precision (min. 4)</small><strong>{comparison.compressedBits} bit</strong><span>{tpsText(comparison.hypothesis.tokensPerSecondCeiling)} tok/s ceiling</span></div>
                </div>
                <p>Compression changes KV memory demand in the model. Quality, quantization kernel overhead, and real runtime speed are unmeasured. A weight-bubble scheduler is a separate future experiment.</p>
              </div>
              {results.warnings.length > 0 && <div className="warnings"><strong>MODEL CAVEATS</strong>{results.warnings.map(w => <p key={w}>• {w}</p>)}</div>}
            </div>
          </div>
        </div>
      </section>

      <MeasuredLab />
      <ResidencyLab />
      <WeightBubbleLab />
      <CalibrationLab />
      <PhotonicLab />

      <section id="architecture" className="architecture container">
        <div className="section-heading"><div><div className="kicker">DESIGN PHILOSOPHY</div><h2>Build from the workload outward.</h2><p>Three layers, one rule: every proposed gain must survive measurement.</p></div></div>
        <div className="architecture-grid">
          <article><div className="architecture-index">01 / MEMORY</div><h3>Keep useful bytes close.</h3><p>Map model weights, KV caches, and reserve space explicitly. Investigate eviction, paging, compression, and locality with correctness checks.</p></article>
          <article><div className="architecture-index">02 / COMPUTE</div><h3>Match hardware to work.</h3><p>Separate compute-heavy prefill from bandwidth-heavy token generation. Benchmark actual operators before specifying custom accelerators.</p></article>
          <article><div className="architecture-index">03 / FABRIC</div><h3>Move less. Move smarter.</h3><p>Quantify host-to-device transfer costs, then research coherent memory, fabric scheduling, and eventually optical interconnects where justified.</p></article>
        </div>
        <div className="roadmap">
          <div><span>R1 • COMPLETE</span><strong>Analytical model</strong><small>Memory, bandwidth and context ceilings with tests</small></div>
          <div><span>R2A • COMPLETE</span><strong>Measured baseline</strong><small>Ollama recorder and controlled repeat comparisons</small></div>
          <div><span>R2B • COMPLETE</span><strong>Model residency controls</strong><small>Explicit cold/preload crossover and latency accounting</small></div>
          <div><span>R2C • COMPLETE</span><strong>Budget-aware weight bubble</strong><small>Offline LRU vs Φ trace replay and eviction ledger</small></div>
          <div><span>R2D • COMPLETE</span><strong>Measured input calibration</strong><small>Isolated R2B profiles, provenance checks, derived offline comparisons</small></div>
          <div><span>P0 • EXPERIMENT</span><strong>Photonics-inspired delay lab</strong><small>Offline PyTorch simulator, controlled baselines, read-only local report import</small></div>
        </div>
      </section>
    </main>
    <footer className="container footer"><div>ΦCORE369 <span>·</span> PHI369 LABS</div><div>Open design. Reproducible evidence. People above profit.</div><a href="https://github.com/MichaelWave369/-Core369" target="_blank" rel="noreferrer">SOURCE ↗</a></footer>
  </div>;
}
