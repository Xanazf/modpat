/**
 * A3 - Manifold visualizer.
 *
 * Usage:
 *   tsx scripts/dev/visualize_manifold.ts [options]
 *
 * Options:
 *   --db <path>   DuckDB path (default: ./data/repl.db)
 *   --src <text>  Source text for path overlay
 *   --tgt <text>  Target text for path overlay
 *   --top <n>     Max atoms to render (default: 2000)
 *   --out <path>  Output HTML file (default: manifold.html)
 *   --open        Open in default browser after starting the server
 *
 * Writes a self-contained HTML file and starts a local HTTP server that queries
 * DuckDB in real-time to stream updates to the browser.
 */

import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { DOPAT_CONFIG } from "@config";
import { OperatorClass } from "@core_i/System";
import { program } from "commander";

program
  .option("--db <path>", "DuckDB path", "./data/repl.db")
  .option("--src <text>", "Source text for path overlay")
  .option("--tgt <text>", "Target text for path overlay")
  .option("--top <n>", "Max atoms to render", "2000")
  .option("--out <path>", "Output HTML file", "manifold.html")
  .option("--open", "Open in default browser")
  .parse();

const opts = program.opts<{
  db: string;
  src?: string;
  tgt?: string;
  top: string;
  out: string;
  open?: boolean;
}>();

// ---------------------------------------------------------------------------
// PCA helpers
// ---------------------------------------------------------------------------

function colMean(mat: Float64Array[], n: number): number[] {
  const d = mat.length;
  const mean = new Array<number>(d).fill(0);
  for (let col = 0; col < d; col++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += mat[col][i];
    mean[col] = s / n;
  }
  return mean;
}

/** Power iteration for one leading eigenvector of the covariance matrix. */
function powerIterate(
  mat: Float64Array[],
  mean: number[],
  n: number,
  deflates?: number[][]
): number[] {
  const d = mat.length;
  let v = new Array<number>(d).fill(0);
  v[0] = 1; // arbitrary start

  for (let iter = 0; iter < 200; iter++) {
    const w = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let col = 0; col < d; col++) {
        dot += (mat[col][i] - mean[col]) * v[col];
      }
      for (let col = 0; col < d; col++) {
        w[col] += (mat[col][i] - mean[col]) * dot;
      }
    }
    for (let col = 0; col < d; col++) w[col] /= n;

    if (deflates) {
      for (const deflate of deflates) {
        let dot = 0;
        for (let col = 0; col < d; col++) dot += w[col] * deflate[col];
        for (let col = 0; col < d; col++) w[col] -= dot * deflate[col];
      }
    }

    let norm = 0;
    for (const x of w) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let col = 0; col < d; col++) w[col] /= norm;

    let diff = 0;
    for (let col = 0; col < d; col++) diff += (w[col] - v[col]) ** 2;
    v = w;
    if (Math.sqrt(diff) < 1e-6) break;
  }
  return v;
}

function pca3d(
  posX: Float64Array,
  posY: Float64Array,
  posZ: Float64Array,
  posW: Float64Array,
  n: number
): Array<[number, number, number]> {
  const mat: Float64Array[] = [posX, posY, posZ, posW].map(a =>
    a.subarray(0, n)
  );
  const mean = colMean(mat, n);
  const pc1 = powerIterate(mat, mean, n);
  const pc2 = powerIterate(mat, mean, n, [pc1]);
  const pc3 = powerIterate(mat, mean, n, [pc1, pc2]);

  return Array.from({ length: n }, (_, i) => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let col = 0; col < 4; col++) {
      const v = mat[col][i] - mean[col];
      x += v * pc1[col];
      y += v * pc2[col];
      z += v * pc3[col];
    }
    return [x, y, z];
  });
}

// ---------------------------------------------------------------------------
// KNN Neighbors Extraction Helper (calculated in 4D space)
// ---------------------------------------------------------------------------

function getNeighbors(
  posX: Float64Array,
  posY: Float64Array,
  posZ: Float64Array,
  posW: Float64Array,
  i: number,
  n: number,
  maxNeighbors = 4
): number[] {
  const distances: Array<{ index: number; dist: number }> = [];
  const xi = posX[i];
  const yi = posY[i];
  const zi = posZ[i];
  const wi = posW[i];

  for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const dx = xi - posX[j];
    const dy = yi - posY[j];
    const dz = zi - posZ[j];
    const dw = wi - posW[j];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    distances.push({ index: j, dist });
  }

  distances.sort((a, b) => a.dist - b.dist);
  return distances
    .slice(0, Math.min(maxNeighbors, distances.length))
    .map(d => d.index);
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function phiColor(phi: number): string {
  const t = Math.min(1, Math.max(0, phi / DOPAT_CONFIG.PHYSICS.PHI_MAX));
  const r = Math.round(255 * t);
  const b = Math.round(255 * (1 - t));
  return `#${r.toString(16).padStart(2, "0")}00${b.toString(16).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Real-time Database Polling
// ---------------------------------------------------------------------------

interface SerializedNode {
  id: number;
  label: string;
  pcaX: number;
  pcaY: number;
  pcaZ: number;
  radius: number;
  color: string;
  glow: number;
  mass: number;
  density: number;
  intensity: number;
  age: number;
  opClass: string;
  neighbors: number[];
}

interface RawPrecept {
  id: number;
  mass: number;
  scope: number;
  label: string;
  density: number;
  intensity: number;
  operatorClass: number;
  posX: number;
  posY: number;
  posZ: number;
  posW: number;
}

export function processPreceptsData(
  precepts: RawPrecept[],
  pathNodeIds: number[]
) {
  const count = precepts.length;
  if (count === 0) return { nodes: [], path: [] };

  const posX = new Float64Array(count);
  const posY = new Float64Array(count);
  const posZ = new Float64Array(count);
  const posW = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const row = precepts[i];
    posX[i] = row.posX;
    posY[i] = row.posY;
    posZ[i] = row.posZ;
    posW[i] = row.posW;
  }

  const points = pca3d(posX, posY, posZ, posW, count);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minW = Infinity;
  let maxW = -Infinity;

  for (let i = 0; i < count; i++) {
    const [x, y, z] = points[i];
    const w = posW[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (w < minW) minW = w;
    if (w > maxW) maxW = w;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;
  const maxRange = Math.max(rangeX, rangeY, rangeZ);

  const scale = (v: number, min: number, range: number) => {
    return ((v - (min + range / 2)) / maxRange) * 300;
  };

  const nodesData: SerializedNode[] = [];
  for (let i = 0; i < count; i++) {
    const row = precepts[i];
    const id = row.id;
    const mass = row.mass;
    const scope = row.scope;
    const density = row.density;
    const intensity = row.intensity;
    const opClassVal = row.operatorClass;

    const [px, py, pz] = points[i];
    const w = posW[i];
    const ageNorm = (w - minW) / (maxW - minW || 1);
    const glow = 0.15 + 0.85 * (1.0 - ageNorm);

    const label = row.label;
    const opClassStr = OperatorClass[opClassVal] || "None";

    const neighbors = getNeighbors(posX, posY, posZ, posW, i, count, 4);

    nodesData.push({
      id,
      label,
      pcaX: scale(px, minX, rangeX),
      pcaY: scale(py, minY, rangeY),
      pcaZ: scale(pz, minZ, rangeZ),
      radius: Math.max(1.5, Math.min(10, Math.sqrt(Math.abs(mass)) * 1.5)),
      color: phiColor(density * 2 + intensity * 1.5 + 5),
      glow,
      mass,
      density,
      intensity,
      age: w,
      opClass: opClassStr,
      neighbors,
    });
  }

  return {
    nodes: nodesData,
    path: pathNodeIds,
  };
}

// ---------------------------------------------------------------------------
// Main Entry
// ---------------------------------------------------------------------------

async function main() {
  const initialPayload = {
    nodes: [] as SerializedNode[],
    path: [] as number[],
  };

  const config = {
    title:
      opts.src && opts.tgt
        ? `${opts.src} ➔ ${opts.tgt}`
        : "ModPAT Manifold (Connecting...)",
    srcText: opts.src || null,
    tgtText: opts.tgt || null,
    seed: DOPAT_CONFIG.SEED,
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ModPAT Manifold 3D Visualizer</title>
  <script>
    window.MANIFOLD_DATA = {
      nodes: ${JSON.stringify(initialPayload.nodes)},
      path: ${JSON.stringify(initialPayload.path)},
      config: ${JSON.stringify(config)}
    };
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #030307;
      --panel-bg: rgba(10, 10, 20, 0.6);
      --panel-border: rgba(255, 255, 255, 0.08);
      --text-primary: #f0f0f5;
      --text-secondary: #9090a5;
      --accent-color: #00e5ff;
      --accent-hover: #00b8d4;
      --path-color: #ff8800;
      --font-sans: 'Outfit', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-primary);
      font-family: var(--font-sans);
      overflow: hidden;
      height: 100vh;
      width: 100vw;
    }

    #canvas-container {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      z-index: 1;
    }

    /* Glassmorphic UI overlays */
    .overlay {
      position: absolute;
      z-index: 10;
      pointer-events: none;
    }

    .interactive {
      pointer-events: auto;
    }

    /* Header */
    header.overlay {
      top: 20px;
      left: 20px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 30%, var(--accent-color) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 2px 10px rgba(0, 229, 255, 0.2);
    }

    .subtitle {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    /* Sidebar / Control Panel */
    .sidebar {
      top: 20px;
      right: 20px;
      width: 320px;
      max-height: calc(100vh - 40px);
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    }

    .section-title {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--accent-color);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 6px;
      margin-bottom: 8px;
    }

    .control-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .control-label {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
    }

    .control-value {
      color: var(--text-primary);
      font-weight: 600;
    }

    /* Sliders styling */
    input[type="range"] {
      -webkit-appearance: none;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      outline: none;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: var(--accent-color);
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 0 8px var(--accent-color);
      transition: transform 0.1s;
    }

    input[type="range"]::-webkit-slider-thumb:hover {
      transform: scale(1.3);
    }

    /* Buttons styling */
    .btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--text-primary);
      padding: 10px 14px;
      border-radius: 8px;
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .btn:hover {
      background: rgba(0, 229, 255, 0.15);
      border-color: var(--accent-color);
      box-shadow: 0 0 12px rgba(0, 229, 255, 0.2);
    }

    .btn-active {
      background: var(--accent-color);
      color: #000;
      border-color: var(--accent-color);
    }

    .btn-active:hover {
      background: var(--accent-hover);
      color: #000;
    }

    .btn-path {
      border-color: rgba(255, 136, 0, 0.4);
    }
    .btn-path:hover {
      background: rgba(255, 136, 0, 0.15);
      border-color: var(--path-color);
      box-shadow: 0 0 12px rgba(255, 136, 0, 0.2);
    }
    .btn-path.btn-active {
      background: var(--path-color);
      color: #000;
      border-color: var(--path-color);
    }
    .btn-path.btn-active:hover {
      background: #e07700;
    }

    /* Search input */
    .search-container {
      position: relative;
    }

    .search-input {
      width: 100%;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent-color);
    }

    .search-results {
      position: absolute;
      top: 100%;
      left: 0;
      width: 100%;
      max-height: 150px;
      background: #0d0d18;
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      margin-top: 4px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    }

    .search-item {
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.1s;
    }

    .search-item:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--accent-color);
    }

    /* Stats panel */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .stat-box {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      padding: 10px;
      text-align: center;
    }

    .stat-val {
      font-family: var(--font-mono);
      font-size: 16px;
      font-weight: 700;
      color: var(--accent-color);
    }

    .stat-label {
      font-size: 9px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }

    /* Floating Tooltip */
    #tooltip {
      position: absolute;
      z-index: 100;
      pointer-events: none;
      background: rgba(5, 5, 10, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      padding: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      width: 250px;
      display: none;
      transition: opacity 0.15s ease;
      opacity: 0;
    }

    .tooltip-header {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 6px;
    }

    .tooltip-row {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 4px;
      font-family: var(--font-mono);
    }

    .tooltip-label {
      color: var(--text-secondary);
    }

    .tooltip-value {
      color: var(--text-primary);
      font-weight: 600;
    }

    /* Legend colors */
    .legend-gradient {
      width: 100%;
      height: 8px;
      background: linear-gradient(to right, #0000ff, #ff0000);
      border-radius: 4px;
      margin-top: 4px;
    }

    .legend-labels {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      margin-top: 4px;
    }

    /* Checkbox list */
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      cursor: pointer;
      user-select: none;
    }

    .checkbox-label input {
      accent-color: var(--accent-color);
    }

    /* Hide scrollbars */
    ::-webkit-scrollbar {
      width: 4px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.1);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 2px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  </style>
</head>
<body>
  <div id="canvas-container"></div>

  <!-- Header -->
  <header class="overlay">
    <h1 id="main-title">ModPAT Manifold 3D</h1>
    <div class="subtitle">4D Space ➔ 3D PCA Projection</div>
  </header>

  <!-- Sidebar -->
  <div class="sidebar overlay interactive">
    <div>
      <div class="section-title">Statistics</div>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-val" id="stat-nodes">0</div>
          <div class="stat-label">Atoms</div>
        </div>
        <div class="stat-box">
          <div class="stat-val" id="stat-links">0</div>
          <div class="stat-label">KNN Edges</div>
        </div>
      </div>
      <div id="path-stats-container" style="display: none; margin-top: 10px;">
        <div class="stat-box" style="width: 100%;">
          <div class="stat-val" id="stat-path-len" style="color: var(--path-color);">0</div>
          <div class="stat-label">Traversal Steps</div>
        </div>
      </div>
    </div>

    <div>
      <div class="section-title">Node Search</div>
      <div class="search-container">
        <input type="text" class="search-input" placeholder="Search atom by word..." id="search-input"/>
        <div class="search-results" id="search-results"></div>
      </div>
    </div>

    <div>
      <div class="section-title">Simulation Forces</div>
      
      <!-- Connection Density K-slider -->
      <div class="control-group" style="margin-bottom: 12px;">
        <div class="control-label">
          <span>Connection Density (K)</span>
          <span class="control-value" id="val-k">2</span>
        </div>
        <input type="range" min="0" max="4" value="2" id="slider-k"/>
      </div>

      <div class="control-group" style="margin-bottom: 12px;">
        <div class="control-label">
          <span>Charge (Repulsion)</span>
          <span class="control-value" id="val-charge">-30</span>
        </div>
        <input type="range" min="-150" max="-5" value="-30" id="slider-charge"/>
      </div>

      <div class="control-group" style="margin-bottom: 12px;">
        <div class="control-label">
          <span>Collision Radius</span>
          <span class="control-value" id="val-collide">8</span>
        </div>
        <input type="range" min="2" max="25" value="8" id="slider-collide"/>
      </div>

      <div class="control-group" style="margin-bottom: 12px;">
        <div class="control-label">
          <span>PCA Constraint</span>
          <span class="control-value" id="val-pca">0.2</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" value="0.2" id="slider-pca"/>
      </div>

      <div class="control-group">
        <div class="control-label">
          <span>Link Force Strength</span>
          <span class="control-value" id="val-link">0.4</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" value="0.4" id="slider-link"/>
      </div>
    </div>

    <div>
      <div class="section-title">Camera & Playback</div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <label class="checkbox-label">
          <input type="checkbox" id="check-auto-rotate" checked/>
          <span>Auto-rotate Camera</span>
        </label>
        
        <button class="btn" id="btn-reset-view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
          Reset View
        </button>

        <button class="btn btn-path" id="btn-tour" style="display: none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Start Path Tour
        </button>
      </div>
    </div>

    <div>
      <div class="section-title">Legend</div>
      <div class="control-group">
        <div class="control-label">
          <span>φ (Density & Intensity)</span>
        </div>
        <div class="legend-gradient"></div>
        <div class="legend-labels">
          <span>Low (Blue)</span>
          <span>High (Red)</span>
        </div>
      </div>
      <div class="control-group" style="margin-top: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
          <div style="width: 12px; height: 12px; border-radius: 50%; background: var(--path-color); box-shadow: 0 0 6px var(--path-color)"></div>
          <span>Traversal Path</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; margin-top: 4px;">
          <div style="width: 16px; height: 2px; background: rgba(68, 68, 255, 0.4)"></div>
          <span>Structural Links (KNN)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; margin-top: 4px; color: var(--text-secondary)">
          <span>Sphere Radius ∝ √Mass</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; margin-top: 4px; color: var(--text-secondary)">
          <span>Sphere Glow ∝ 1/Age (W)</span>
        </div>
      </div>

      <!-- Operator Colors Legend -->
      <div style="margin-top: 15px;">
        <div class="section-title" style="font-size:10px; color: var(--text-secondary); border-color: rgba(255,255,255,0.03)">Operators Legend</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; font-size: 10px; color: var(--text-secondary)">
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #d946ef"></div>
            <span>IdentityShift</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e"></div>
            <span>Conjunction</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444"></div>
            <span>Sink</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #f97316"></div>
            <span>Quantifier</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b"></div>
            <span>Modifier</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #f43f5e"></div>
            <span>Inversion</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #eab308"></div>
            <span>Action</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #06b6d4"></div>
            <span>Query</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #3b82f6"></div>
            <span>SyntaxAnchor</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #fbbf24"></div>
            <span>Capability</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tooltip -->
  <div id="tooltip">
    <div class="tooltip-header" id="tt-word">Word</div>
    <div class="tooltip-row">
      <span class="tooltip-label">ID</span>
      <span class="tooltip-value" id="tt-id">0</span>
    </div>
    <div class="tooltip-row">
      <span class="tooltip-label">Mass</span>
      <span class="tooltip-value" id="tt-mass">0</span>
    </div>
    <div class="tooltip-row">
      <span class="tooltip-label">Density</span>
      <span class="tooltip-value" id="tt-density">0</span>
    </div>
    <div class="tooltip-row">
      <span class="tooltip-label">Intensity</span>
      <span class="tooltip-value" id="tt-intensity">0</span>
    </div>
    <div class="tooltip-row">
      <span class="tooltip-label">Age (W)</span>
      <span class="tooltip-value" id="tt-age">0</span>
    </div>
    <div class="tooltip-row" style="margin-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 6px;">
      <span class="tooltip-label">Operator</span>
      <span class="tooltip-value" id="tt-op" style="color: var(--accent-color)">None</span>
    </div>
  </div>

  <!-- Import maps polyfill -->
  <script async src="https://unpkg.com/es-module-shims@1.6.3/dist/es-module-shims.js"></script>
  <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
      }
    }
  </script>

  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { forceSimulation, forceManyBody, forceCenter, forceLink, forceX, forceY, forceZ, forceCollide } from 'https://cdn.jsdelivr.net/npm/d3-force-3d@3.0.6/+esm';

    const data = window.MANIFOLD_DATA;
    const { nodes, path, config } = data;

    // Operator colors mapping
    const operatorColors = {
      'None': '#4d94ff',
      'IdentityShift': '#d946ef',
      'Conjunction': '#22c55e',
      'Sink': '#ef4444',
      'Quantifier': '#f97316',
      'Modifier': '#f59e0b',
      'Inversion': '#f43f5e',
      'Action': '#eab308',
      'Query': '#06b6d4',
      'SyntaxAnchor': '#3b82f6',
      'Intent': '#ec4899',
      'Arithmetic': '#84cc16',
      'Capability': '#fbbf24'
    };

    // Set stats
    document.getElementById('stat-nodes').innerText = nodes.length;
    if (config.title) {
      document.getElementById('main-title').innerText = config.title;
    }

    const hasPath = path && path.length > 0;
    if (hasPath) {
      document.getElementById('path-stats-container').style.display = 'block';
      document.getElementById('stat-path-len').innerText = path.length;
      document.getElementById('btn-tour').style.display = 'flex';
    }

    // Prepare simulation nodes
    const simNodes = nodes.map(n => ({
      index: n.id,
      x: n.pcaX,
      y: n.pcaY,
      z: n.pcaZ,
      vx: 0, vy: 0, vz: 0,
      radius: n.radius,
      pcaX: n.pcaX,
      pcaY: n.pcaY,
      pcaZ: n.pcaZ
    }));

    // Function to calculate active links dynamically from pre-calculated neighbors
    function getActiveLinks(k) {
      const activeLinks = [];
      const seen = new Set();
      
      nodes.forEach((n, idx) => {
        const count = Math.min(k, n.neighbors.length);
        for (let j = 0; j < count; j++) {
          const targetIdx = n.neighbors[j];
          const u = Math.min(idx, targetIdx);
          const v = Math.max(idx, targetIdx);
          const key = u + '-' + v;
          if (!seen.has(key)) {
            seen.add(key);
            activeLinks.push({
              source: u,
              target: v,
              strength: 0.1
            });
          }
        }
      });

      // Add path traversal links
      if (hasPath) {
        for (let i = 0; i < path.length - 1; i++) {
          activeLinks.push({
            source: path[i],
            target: path[i+1],
            strength: 1.0 // Stronger connection for paths
          });
        }
      }
      
      return activeLinks;
    }

    // Set initial link density (K)
    let currentK = 2;
    document.getElementById('stat-links').innerText = getActiveLinks(currentK).filter(l => !hasPath || l.strength < 1.0).length;

    // Force simulation setup
    let chargeStr = -30;
    let collideRadius = 8;
    let pcaStrength = 0.2;
    let linkStrength = 0.4;

    const initialLinks = getActiveLinks(currentK);

    const simulation = forceSimulation(simNodes)
      .numDimensions(3)
      .force('charge', forceManyBody().strength(chargeStr))
      .force('center', forceCenter(0, 0, 0))
      .force('collide', forceCollide().radius(d => d.radius + collideRadius).iterations(1))
      .force('link', forceLink(initialLinks).id(d => d.index).strength(l => l.strength * linkStrength))
      .force('x', forceX().x(d => d.pcaX).strength(pcaStrength))
      .force('y', forceY().y(d => d.pcaY).strength(pcaStrength))
      .force('z', forceZ().z(d => d.pcaZ).strength(pcaStrength));

    // Keep the simulation alive and floating in real-time
    simulation.alphaTarget(0.015);

    // Three.js Scene Setup
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030307, 0.0015);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    camera.position.set(0, 180, 320);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(scene.fog.color);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 1000;
    controls.minDistance = 10;

    // Lights
    const ambientLight = new THREE.AmbientLight(0x1a1a2e);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(200, 400, 300);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x00e5ff, 0.4);
    dirLight2.position.set(-200, -200, -100);
    scene.add(dirLight2);

    // Grid helper in the middle
    const gridHelper = new THREE.GridHelper(600, 30, 0x1d1d3d, 0x0f0f20);
    gridHelper.position.y = -180;
    scene.add(gridHelper);

    // Background Space Dust
    const starsGeom = new THREE.BufferGeometry();
    const starsCount = 1000;
    const starsPos = new Float32Array(starsCount * 3);
    for (let i = 0; i < starsCount * 3; i++) {
      starsPos[i] = (Math.random() - 0.5) * 1200;
    }
    starsGeom.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
    const starsMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.5,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true
    });
    const starField = new THREE.Points(starsGeom, starsMat);
    scene.add(starField);

    // Node geometries and meshes
    const sphereGeom = new THREE.SphereGeometry(1, 12, 12);
    const nodeMeshes = [];

    nodes.forEach((n, idx) => {
      const colorHex = n.opClass === 'None' ? n.color : (operatorColors[n.opClass] || '#9ca3af');
      const color = new THREE.Color(colorHex);
      const glow = n.glow;

      const mat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: glow * 2.2,
        roughness: 0.1,
        metalness: 0.1,
        transparent: true,
        opacity: Math.max(0.4, glow)
      });

      const mesh = new THREE.Mesh(sphereGeom, mat);
      mesh.scale.setScalar(n.radius);
      mesh.position.set(n.pcaX, n.pcaY, n.pcaZ);
      
      mesh.userData = { id: n.id, data: n };
      scene.add(mesh);
      nodeMeshes.push(mesh);
    });

    // Special path node rendering overlays (subtle halos)
    const pathHalos = [];
    if (hasPath) {
      const haloGeom = new THREE.SphereGeometry(1.3, 12, 12);
      path.forEach(id => {
        const n = nodes[id];
        if (n) {
          const haloMat = new THREE.MeshBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.3,
            wireframe: true
          });
          const haloMesh = new THREE.Mesh(haloGeom, haloMat);
          haloMesh.scale.setScalar(n.radius);
          scene.add(haloMesh);
          pathHalos.push({ id, mesh: haloMesh });
        }
      });
    }

    // KNN Structural Links (Pre-allocated for max K=4)
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x4444ff,
      transparent: true,
      opacity: 0.15,
      depthWrite: false
    });
    const maxLinksCount = nodes.length * 4 + (hasPath ? path.length : 0);
    const lineGeom = new THREE.BufferGeometry();
    const linePositions = new Float32Array(maxLinksCount * 6);
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const lineSegments = new THREE.LineSegments(lineGeom, lineMat);
    scene.add(lineSegments);

    // Path segment line
    let pathLine;
    let pathPulseParticles = [];
    let pathCurve;

    if (hasPath && path.length >= 2) {
      const pathLineMat = new THREE.LineBasicMaterial({
        color: 0xff8800,
        linewidth: 3,
        transparent: true,
        opacity: 0.85
      });
      const pathLineGeom = new THREE.BufferGeometry();
      const tempPositions = new Float32Array(path.length * 3);
      pathLineGeom.setAttribute('position', new THREE.BufferAttribute(tempPositions, 3));
      pathLine = new THREE.Line(pathLineGeom, pathLineMat);
      scene.add(pathLine);

      // Create glowing energy pulses along path
      const pulseCount = Math.min(6, path.length * 2);
      for (let i = 0; i < pulseCount; i++) {
        const pGeom = new THREE.SphereGeometry(0.8, 8, 8);
        const pMat = new THREE.MeshBasicMaterial({
          color: 0xffbb33,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending
        });
        const pMesh = new THREE.Mesh(pGeom, pMat);
        scene.add(pMesh);
        pathPulseParticles.push({
          mesh: pMesh,
          progress: i / pulseCount
        });
      }
    }

    // Mouse Interaction (Hover & Drag Raycasting)
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredMesh = null;
    let originalEmissive = new THREE.Color();
    let originalEmissiveIntensity = 1;

    // Drag tracking variables
    const dragPlane = new THREE.Plane();
    const dragPlaneNormal = new THREE.Vector3();
    let draggedMesh = null;
    let draggedNode = null;

    const tooltip = document.getElementById('tooltip');
    const ttWord = document.getElementById('tt-word');
    const ttId = document.getElementById('tt-id');
    const ttMass = document.getElementById('tt-mass');
    const ttDensity = document.getElementById('tt-density');
    const ttIntensity = document.getElementById('tt-intensity');
    const ttAge = document.getElementById('tt-age');
    const ttOp = document.getElementById('tt-op');

    window.addEventListener('mousemove', (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY + 15) + 'px';

      if (draggedNode && draggedMesh) {
        raycaster.setFromCamera(mouse, camera);
        const intersectionPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, intersectionPoint);
        
        draggedNode.fx = intersectionPoint.x;
        draggedNode.fy = intersectionPoint.y;
        draggedNode.fz = intersectionPoint.z;
        
        simulation.alphaTarget(0.3).restart();
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('.interactive')) return;

      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(nodeMeshes);

      if (intersects.length > 0) {
        draggedMesh = intersects[0].object;
        const nodeId = draggedMesh.userData.id;
        draggedNode = simNodes.find(sn => sn.index === nodeId);

        if (draggedNode) {
          controls.enabled = false;
          camera.getWorldDirection(dragPlaneNormal);
          dragPlaneNormal.negate();
          dragPlane.setFromNormalAndCoplanarPoint(dragPlaneNormal, draggedMesh.position);

          tooltip.style.opacity = '0';
          tooltip.style.display = 'none';
        }
      }
    });

    function endDrag() {
      if (draggedNode) {
        draggedNode.fx = null;
        draggedNode.fy = null;
        draggedNode.fz = null;
        draggedNode = null;
        draggedMesh = null;
        controls.enabled = true;
        simulation.alphaTarget(0.015);
      }
    }

    window.addEventListener('mouseup', endDrag);
    window.addEventListener('mouseleave', endDrag);

    // Node Search Autocomplete
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      if (!q) {
        searchResults.style.display = 'none';
        return;
      }

      const matches = nodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 10);
      if (matches.length === 0) {
        searchResults.innerHTML = '<div class="search-item" style="color:var(--text-secondary)">No match found</div>';
      } else {
        searchResults.innerHTML = matches.map(n => 
          '<div class="search-item" data-id="' + n.id + '">' + n.label + ' <span style="color:var(--text-secondary);font-size:10px">(id: ' + n.id + ')</span></div>'
        ).join('');
      }
      searchResults.style.display = 'block';
    });

    searchResults.addEventListener('click', (e) => {
      const item = e.target.closest('.search-item');
      if (!item) return;

      const nodeId = parseInt(item.getAttribute('data-id'));
      if (isNaN(nodeId)) return;

      const nodeData = nodes.find(node => node.id === nodeId);
      if (nodeData) {
        searchInput.value = nodeData.label;
        searchResults.style.display = 'none';
        focusOnNode(nodeId);
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) {
        searchResults.style.display = 'none';
      }
    });

    function focusOnNode(id) {
      const simNode = simNodes.find(sn => sn.index === id);
      if (!simNode) return;

      const mesh = nodeMeshes.find(m => m.userData.id === id);
      if (mesh) {
        const mat = mesh.material;
        const originalColor = mat.color.getHex();
        mat.color.setHex(0xffffff);
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 6.0;
        
        setTimeout(() => {
          mat.color.setHex(originalColor);
          mat.emissive.setHex(originalColor);
          const nodeRef = nodes.find(node => node.id === id);
          const glow = nodeRef ? nodeRef.glow : 1.0;
          mat.emissiveIntensity = glow * 2.2;
        }, 1500);
      }

      const targetPos = new THREE.Vector3(simNode.x, simNode.y, simNode.z);
      const offset = new THREE.Vector3(0, 50, 100);
      
      const startCamPos = camera.position.clone();
      const endCamPos = targetPos.clone().add(offset);

      const duration = 1000;
      const startTime = performance.now();

      controls.enabled = false;

      function animCam(now) {
        const progress = Math.min(1, (now - startTime) / duration);
        const t = progress * progress * (3 - 2 * progress);
        
        camera.position.lerpVectors(startCamPos, endCamPos, t);
        controls.target.lerpVectors(controls.target, targetPos, t);
        
        if (progress < 1) {
          requestAnimationFrame(animCam);
        } else {
          controls.enabled = true;
        }
      }
      requestAnimationFrame(animCam);
    }

    // Camera Path Tour
    let isTourActive = false;
    let tourStartTime = 0;
    const tourDurationPerNode = 1200;

    const btnTour = document.getElementById('btn-tour');
    btnTour.addEventListener('click', () => {
      isTourActive = !isTourActive;
      if (isTourActive) {
        btnTour.classList.add('btn-active');
        btnTour.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/></svg> Stop Path Tour';
        tourStartTime = performance.now();
        controls.enabled = false;
      } else {
        btnTour.classList.remove('btn-active');
        btnTour.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Path Tour';
        controls.enabled = true;
      }
    });

    // Forces UI Hookups
    const sliderK = document.getElementById('slider-k');
    const valK = document.getElementById('val-k');
    sliderK.addEventListener('input', () => {
      currentK = parseInt(sliderK.value);
      valK.innerText = currentK;
      
      const newLinks = getActiveLinks(currentK);
      document.getElementById('stat-links').innerText = newLinks.filter(l => !hasPath || l.strength < 1.0).length;

      simulation.force('link').links(newLinks);
      simulation.alpha(0.3).restart();
    });

    const sliderCharge = document.getElementById('slider-charge');
    const valCharge = document.getElementById('val-charge');
    sliderCharge.addEventListener('input', () => {
      chargeStr = parseInt(sliderCharge.value);
      valCharge.innerText = chargeStr;
      simulation.force('charge').strength(chargeStr);
      simulation.alpha(0.3).restart();
    });

    const sliderCollide = document.getElementById('slider-collide');
    const valCollide = document.getElementById('val-collide');
    sliderCollide.addEventListener('input', () => {
      collideRadius = parseInt(sliderCollide.value);
      valCollide.innerText = collideRadius;
      simulation.force('collide').radius(d => d.radius + collideRadius);
      simulation.alpha(0.3).restart();
    });

    const sliderPca = document.getElementById('slider-pca');
    const valPca = document.getElementById('val-pca');
    sliderPca.addEventListener('input', () => {
      pcaStrength = parseFloat(sliderPca.value);
      valPca.innerText = pcaStrength.toFixed(2);
      simulation.force('x').strength(pcaStrength);
      simulation.force('y').strength(pcaStrength);
      simulation.force('z').strength(pcaStrength);
      simulation.alpha(0.3).restart();
    });

    const sliderLink = document.getElementById('slider-link');
    const valLink = document.getElementById('val-link');
    sliderLink.addEventListener('input', () => {
      linkStrength = parseFloat(sliderLink.value);
      valLink.innerText = linkStrength.toFixed(2);
      simulation.force('link').strength(l => l.strength * linkStrength);
      simulation.alpha(0.3).restart();
    });

    // View Controls Hookups
    const checkAutoRotate = document.getElementById('check-auto-rotate');
    const btnResetView = document.getElementById('btn-reset-view');

    btnResetView.addEventListener('click', () => {
      isTourActive = false;
      btnTour.classList.remove('btn-active');
      btnTour.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Path Tour';
      controls.enabled = true;
      controls.target.set(0, 0, 0);
      camera.position.set(0, 180, 320);
      controls.update();
    });

    // Dynamic Differential Updates (smooth D3 enter/update/exit pattern)
    function updateSceneData(newNodes, newPath) {
      const nodeMap = new Map(simNodes.map(n => [n.index, n]));
      const meshMap = new Map(nodeMeshes.map(m => [m.userData.id, m]));

      // 1. Process current/new nodes
      const nextSimNodes = [];
      const nextNodeMeshes = [];
      const activeIds = new Set(newNodes.map(n => n.id));

      newNodes.forEach((n, idx) => {
        let simNode = nodeMap.get(n.id);
        let mesh = meshMap.get(n.id);

        const colorHex = n.opClass === 'None' ? n.color : (operatorColors[n.opClass] || '#9ca3af');
        const color = new THREE.Color(colorHex);

        if (!simNode) {
          // New Node!
          simNode = {
            index: n.id,
            x: n.pcaX,
            y: n.pcaY,
            z: n.pcaZ,
            vx: 0, vy: 0, vz: 0,
            radius: n.radius,
            pcaX: n.pcaX,
            pcaY: n.pcaY,
            pcaZ: n.pcaZ
          };
          
          const mat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: n.glow * 2.2,
            roughness: 0.1,
            metalness: 0.1,
            transparent: true,
            opacity: Math.max(0.4, n.glow)
          });
          mesh = new THREE.Mesh(sphereGeom, mat);
          mesh.scale.setScalar(n.radius);
          mesh.position.set(n.pcaX, n.pcaY, n.pcaZ);
          mesh.userData = { id: n.id, data: n };
          scene.add(mesh);
        } else {
          // Update existing node properties
          simNode.pcaX = n.pcaX;
          simNode.pcaY = n.pcaY;
          simNode.pcaZ = n.pcaZ;
          simNode.radius = n.radius;
          
          mesh.scale.setScalar(n.radius);
          mesh.material.color.copy(color);
          mesh.material.emissive.copy(color);
          mesh.material.emissiveIntensity = n.glow * 2.2;
          mesh.material.opacity = Math.max(0.4, n.glow);
          mesh.userData.data = n;
        }

        nextSimNodes.push(simNode);
        nextNodeMeshes.push(mesh);
      });

      // 2. Remove obsolete nodes
      simNodes.forEach(n => {
        if (!activeIds.has(n.index)) {
          const mesh = meshMap.get(n.index);
          if (mesh) {
            scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
          }
        }
      });

      // Update arrays in place
      simNodes.length = 0;
      simNodes.push(...nextSimNodes);
      
      nodeMeshes.length = 0;
      nodeMeshes.push(...nextNodeMeshes);

      nodes.length = 0;
      nodes.push(...newNodes);

      // 3. Update Path
      path.length = 0;
      path.push(...newPath);

      const hasPathNow = path.length > 0;
      const pathStats = document.getElementById('path-stats-container');
      const statPathLen = document.getElementById('stat-path-len');
      const btnTour = document.getElementById('btn-tour');

      if (hasPathNow) {
        pathStats.style.display = 'block';
        statPathLen.innerText = path.length;
        btnTour.style.display = 'flex';
      } else {
        pathStats.style.display = 'none';
        btnTour.style.display = 'none';
        isTourActive = false;
        btnTour.classList.remove('btn-active');
        btnTour.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Path Tour';
        controls.enabled = true;
      }

      pathHalos.forEach(h => scene.remove(h.mesh));
      pathHalos.length = 0;

      if (hasPathNow) {
        const haloGeom = new THREE.SphereGeometry(1.3, 12, 12);
        path.forEach(id => {
          const n = nodes.find(node => node.id === id);
          if (n) {
            const haloMat = new THREE.MeshBasicMaterial({
              color: 0xffaa00,
              transparent: true,
              opacity: 0.3,
              wireframe: true
            });
            const haloMesh = new THREE.Mesh(haloGeom, haloMat);
            haloMesh.scale.setScalar(n.radius);
            scene.add(haloMesh);
            pathHalos.push({ id, mesh: haloMesh });
          }
        });
      }

      if (pathLine) scene.remove(pathLine);
      pathPulseParticles.forEach(p => scene.remove(p.mesh));
      pathPulseParticles.length = 0;

      if (hasPathNow && path.length >= 2) {
        const pathLineMat = new THREE.LineBasicMaterial({
          color: 0xff8800,
          linewidth: 3,
          transparent: true,
          opacity: 0.85
        });
        const pathLineGeom = new THREE.BufferGeometry();
        const tempPositions = new Float32Array(path.length * 3);
        pathLineGeom.setAttribute('position', new THREE.BufferAttribute(tempPositions, 3));
        pathLine = new THREE.Line(pathLineGeom, pathLineMat);
        scene.add(pathLine);

        const pulseCount = Math.min(6, path.length * 2);
        for (let i = 0; i < pulseCount; i++) {
          const pGeom = new THREE.SphereGeometry(0.8, 8, 8);
          const pMat = new THREE.MeshBasicMaterial({
            color: 0xffbb33,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending
          });
          const pMesh = new THREE.Mesh(pGeom, pMat);
          scene.add(pMesh);
          pathPulseParticles.push({
            mesh: pMesh,
            progress: i / pulseCount
          });
        }
      }

      // 4. Update Simulation structure & links
      document.getElementById('stat-nodes').innerText = nodes.length;
      
      const newLinks = getActiveLinks(currentK);
      document.getElementById('stat-links').innerText = newLinks.filter(l => !hasPath || l.strength < 1.0).length;

      simulation.nodes(simNodes);
      simulation.force('link').links(newLinks);
      simulation.alpha(0.1).restart();
    }

    // Real-time server polling
    async function pollData() {
      try {
        const response = await fetch('/api/data');
        if (!response.ok) return;
        const result = await response.json();
        if (result && result.nodes) {
          updateSceneData(result.nodes, result.path);
        }
      } catch (err) {
        // Silent catch when offline or server not running (works as static file)
        console.warn('Poller disconnected:', err);
      }
    }
    // Poll every 1.5 seconds
    setInterval(pollData, 1500);

    // Simulation Tick Listener
    simulation.on('tick', () => {
      for (let i = 0; i < simNodes.length; i++) {
        const sNode = simNodes[i];
        const mesh = nodeMeshes[i];
        if (mesh) {
          mesh.position.set(sNode.x, sNode.y, sNode.z);
        }
      }

      pathHalos.forEach(halo => {
        const sNode = simNodes.find(sn => sn.index === halo.id);
        if (sNode) {
          halo.mesh.position.set(sNode.x, sNode.y, sNode.z);
        }
      });

      const posAttr = lineGeom.attributes.position;
      const positions = posAttr.array;
      
      let index = 0;
      let activeLinksCount = 0;
      const currentLinks = getActiveLinks(currentK);

      currentLinks.forEach(l => {
        const s = typeof l.source === 'object' ? l.source : simNodes.find(sn => sn.index === l.source);
        const t = typeof l.target === 'object' ? l.target : simNodes.find(sn => sn.index === l.target);
        if (s && t) {
          positions[index++] = s.x;
          positions[index++] = s.y;
          positions[index++] = s.z;
          positions[index++] = t.x;
          positions[index++] = t.y;
          positions[index++] = t.z;
          activeLinksCount++;
        }
      });
      posAttr.needsUpdate = true;
      lineGeom.setDrawRange(0, activeLinksCount * 2);

      if (hasPath && path.length >= 2) {
        const points = [];
        path.forEach(id => {
          const s = simNodes.find(sn => sn.index === id);
          if (s) points.push(new THREE.Vector3(s.x, s.y, s.z));
        });

        if (points.length >= 2) {
          pathCurve = new THREE.CatmullRomCurve3(points);
          const curvePoints = pathCurve.getPoints(100);
          
          const pathPosAttr = pathLine.geometry.attributes.position;
          const pathPositions = pathPosAttr.array;
          
          let pathIdx = 0;
          curvePoints.forEach(p => {
            pathPositions[pathIdx++] = p.x;
            pathPositions[pathIdx++] = p.y;
            pathPositions[pathIdx++] = p.z;
          });
          pathPosAttr.needsUpdate = true;
        }
      }
    });

    // Animation / Render Loop
    const clock = new THREE.Clock();

    function animate() {
      requestAnimationFrame(animate);

      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      if (checkAutoRotate.checked && !isTourActive) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
      } else {
        controls.autoRotate = false;
      }

      if (hasPath && pathCurve && pathPulseParticles.length > 0) {
        pathPulseParticles.forEach(p => {
          p.progress = (p.progress + delta * 0.08) % 1.0;
          const pos = pathCurve.getPointAt(p.progress);
          p.mesh.position.copy(pos);
          p.mesh.scale.setScalar(1.0 + Math.sin(elapsed * 5.0 + p.progress * 10.0) * 0.15);
        });
      }

      if (isTourActive && hasPath && pathCurve) {
        const totalTourTime = path.length * tourDurationPerNode;
        const tourElapsed = (performance.now() - tourStartTime) % totalTourTime;
        
        const progress = tourElapsed / totalTourTime;
        const pathPos = pathCurve.getPointAt(progress);
        
        const lookAheadProgress = Math.min(1.0, progress + 0.05);
        const lookTarget = pathCurve.getPointAt(lookAheadProgress);

        const tangent = pathCurve.getTangentAt(progress).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
        
        const camOffset = new THREE.Vector3()
          .copy(tangent).multiplyScalar(-35)
          .addScaledVector(right, 10)
          .addScaledVector(up, 18);
          
        const targetCamPos = new THREE.Vector3().copy(pathPos).add(camOffset);
        
        camera.position.lerp(targetCamPos, 0.05);
        controls.target.lerp(lookTarget, 0.05);
      }

      if (!draggedNode) {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(nodeMeshes);

        if (intersects.length > 0) {
          const closestIntersect = intersects[0];
          const mesh = closestIntersect.object;

          if (hoveredMesh !== mesh) {
            if (hoveredMesh) {
              hoveredMesh.material.emissive.copy(originalEmissive);
              hoveredMesh.material.emissiveIntensity = originalEmissiveIntensity;
            }

            hoveredMesh = mesh;
            originalEmissive.copy(mesh.material.emissive);
            originalEmissiveIntensity = mesh.material.emissiveIntensity;

            mesh.material.emissive.setHex(0xffffff);
            mesh.material.emissiveIntensity = 4.0;

            const d = mesh.userData.data;
            ttWord.innerText = d.label;
            ttId.innerText = d.id;
            ttMass.innerText = d.mass.toFixed(4);
            ttDensity.innerText = d.density.toFixed(4);
            ttIntensity.innerText = d.intensity.toFixed(4);
            ttAge.innerText = d.age.toFixed(4);
            ttOp.innerText = d.opClass;
            
            tooltip.style.display = 'block';
            setTimeout(() => { tooltip.style.opacity = '1'; }, 10);
          }
        } else {
          if (hoveredMesh) {
            hoveredMesh.material.emissive.copy(originalEmissive);
            hoveredMesh.material.emissiveIntensity = originalEmissiveIntensity;
            hoveredMesh = null;
            
            tooltip.style.opacity = '0';
            setTimeout(() => {
              if (!hoveredMesh) tooltip.style.display = 'none';
            }, 150);
          }
        }
      }

      controls.update();
      renderer.render(scene, camera);
    }

    window.addEventListener('resize', () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });

    animate();
  </script>
</body>
</html>`;

  // Write static copy to output file
  writeFileSync(opts.out, html, "utf8");
  console.log(`Snapshot Written: ${opts.out}`);

  let currentPayload = initialPayload;

  // Start HTTP Server for real-time differential polling
  const port = 3000;
  const server = createServer((req, res) => {
    const url = req.url || "/";

    if (url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else if (url === "/api/data") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(currentPayload));
    } else if (url === "/api/update" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const update = JSON.parse(body);
          if (update.precepts) {
            currentPayload = processPreceptsData(
              update.precepts,
              update.path || []
            );
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              src: opts.src || null,
              tgt: opts.tgt || null,
            })
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`Invalid JSON: ${msg}`);
        }
      });
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    console.log(
      `\n=============================================================`
    );
    console.log(`ModPAT 3D Manifold Visualizer Server running.`);
    console.log(`Open in browser: http://localhost:${port}/`);
    console.log(`Press Ctrl+C to stop the server.`);
    console.log(
      `=============================================================\n`
    );

    if (opts.open) {
      import("node:child_process").then(({ spawn }) => {
        const opener =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        spawn(opener, [`http://localhost:${port}/`], {
          detached: true,
          stdio: "ignore",
        }).unref();
      });
    }
  });

  const shutdown = async () => {
    console.log("\nShutting down server...");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("visualize_manifold.ts") ||
    process.argv[1].endsWith("visualize_manifold"));

if (isMain) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
