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
 *   --open        Open the HTML file in the default browser after writing
 *
 * Writes a self-contained HTML file.  No Claude Code dependency.
 *
 * PCA is performed on the N×4 position matrix using power iteration for the
 * top-2 eigenvectors - no external dependency.
 */

import { writeFileSync } from "node:fs";
import { DOPAT_CONFIG } from "@config";
import Runtime from "@core_i/Runtime";
import { program } from "commander";

program
  .option("--db <path>", "DuckDB path", "./data/repl.db")
  .option("--src <text>", "Source text for path overlay")
  .option("--tgt <text>", "Target text for path overlay")
  .option("--top <n>", "Max atoms to render", "2000")
  .option("--out <path>", "Output HTML file", "manifold.html")
  .option("--open", "Open in default browser after writing")
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
  deflate?: number[]
): number[] {
  const d = mat.length;
  let v = new Array<number>(d).fill(0);
  v[0] = 1; // arbitrary start

  for (let iter = 0; iter < 200; iter++) {
    // w = C v  where C = (1/n) Σ (x_i − μ)(x_i − μ)ᵀ
    const w = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let col = 0; col < d; col++)
        dot += (mat[col][i] - mean[col]) * v[col];
      for (let col = 0; col < d; col++)
        w[col] += (mat[col][i] - mean[col]) * dot;
    }
    for (let col = 0; col < d; col++) w[col] /= n;

    // deflate against first PC if requested
    if (deflate) {
      let dot = 0;
      for (let col = 0; col < d; col++) dot += w[col] * deflate[col];
      for (let col = 0; col < d; col++) w[col] -= dot * deflate[col];
    }

    // normalize
    let norm = 0;
    for (const x of w) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let col = 0; col < d; col++) w[col] /= norm;

    // converged?
    let diff = 0;
    for (let col = 0; col < d; col++) diff += (w[col] - v[col]) ** 2;
    v = w;
    if (Math.sqrt(diff) < 1e-6) break;
  }
  return v;
}

function pca2d(
  posX: Float64Array,
  posY: Float64Array,
  posZ: Float64Array,
  posW: Float64Array,
  n: number
): Array<[number, number]> {
  const mat: Float64Array[] = [posX, posY, posZ, posW].map(a =>
    a.subarray(0, n)
  );
  const mean = colMean(mat, n);
  const pc1 = powerIterate(mat, mean, n);
  const pc2 = powerIterate(mat, mean, n, pc1);

  return Array.from({ length: n }, (_, i) => {
    let x = 0,
      y = 0;
    for (let col = 0; col < 4; col++) {
      const v = mat[col][i] - mean[col];
      x += v * pc1[col];
      y += v * pc2[col];
    }
    return [x, y];
  });
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** Map φ ∈ [0, PHI_MAX] to a blue→red hex colour. */
function phiColor(phi: number): string {
  const t = Math.min(1, phi / DOPAT_CONFIG.PHYSICS.PHI_MAX);
  const r = Math.round(255 * t);
  const b = Math.round(255 * (1 - t));
  return `#${r.toString(16).padStart(2, "0")}00${b.toString(16).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rt = await Runtime.boot({ db: opts.db, atomizer: "semantic" });
  const system = rt.system;

  const n = Math.min(system.length, parseInt(opts.top));
  console.log(`Projecting ${n} atoms to 2D via PCA…`);

  const points = pca2d(system.posX, system.posY, system.posZ, system.posW, n);

  // Scale to canvas space (600 × 600 px)
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rangeX = maxX - minX || 1,
    rangeY = maxY - minY || 1;
  const scale = (v: number, min: number, range: number) =>
    ((v - min) / range) * 600 - 300;

  // Internal flat shape representation used by the SVG writer below
  interface AtomShape {
    _cx: number;
    _cy: number;
    _r: number;
    _fill: string;
  }
  const shapes: AtomShape[] = [];

  for (let i = 0; i < n; i++) {
    const [px, py] = points[i];
    const m = Math.abs(system.mass[i]);
    shapes.push({
      _cx: scale(px, minX, rangeX),
      _cy: scale(py, minY, rangeY),
      _r: Math.max(2, Math.min(12, Math.sqrt(m) * 0.5)),
      _fill: phiColor(system.density[i] * 2 + system.intensity[i] * 1.5 + 5),
    });
  }

  // Optional path overlay
  const pathSegments: Array<[number, number]> = [];
  if (opts.src && opts.tgt) {
    const srcResult = rt.language!.ingest(opts.src);
    const tgtResult = rt.language!.ingest(opts.tgt);
    const srcIds = srcResult.ids;
    const tgtIds = tgtResult.ids;
    if (srcIds.length > 0 && tgtIds.length > 0) {
      console.log(`Computing path: "${opts.src}" → "${opts.tgt}"…`);
      rt.mapper.setGPUEnabled(false);
      const pathIds = await rt.mapper.traverse(
        srcIds[0],
        tgtIds[tgtIds.length - 1],
        { steps: 16, maxIterations: 60 }
      );
      for (const id of pathIds) {
        if (id < n) {
          const [px, py] = points[id];
          pathSegments.push([scale(px, minX, rangeX), scale(py, minY, rangeY)]);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build SVG elements
  // ---------------------------------------------------------------------------
  const W = 900,
    H = 900,
    PAD = 40;
  const innerW = W - PAD * 2,
    innerH = H - PAD * 2;

  const svgAtoms = shapes
    .map(s => {
      const cx = (s._cx * innerW) / 600 + W / 2;
      const cy = (s._cy * innerH) / 600 + H / 2;
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${s._r.toFixed(1)}" fill="${s._fill}" fill-opacity="0.75" stroke="none"/>`;
    })
    .join("\n    ");

  const svgPath =
    pathSegments.length >= 2
      ? `<polyline points="${pathSegments.map(([x, y]) => `${((x * innerW) / 600 + W / 2).toFixed(1)},${((y * innerH) / 600 + H / 2).toFixed(1)}`).join(" ")}" fill="none" stroke="#ff8800" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`
      : "";

  const legendGrad = `<defs>
    <linearGradient id="phiGrad" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#0000ff"/>
      <stop offset="100%" stop-color="#ff0000"/>
    </linearGradient>
  </defs>`;

  const title =
    opts.src && opts.tgt
      ? `${opts.src} → ${opts.tgt}`
      : `ModPAT manifold (${n} atoms)`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>ModPAT manifold</title>
<style>
  body { margin: 0; background: #0e0e14; display: flex; flex-direction: column; align-items: center; font-family: monospace; color: #ccc; }
  h1 { font-size: 13px; margin: 10px 0 2px; opacity: 0.7; }
  svg { display: block; }
  .legend { display: flex; align-items: center; gap: 8px; font-size: 11px; margin: 4px 0 10px; }
  .legend rect { display: block; }
</style>
</head>
<body>
<h1>${title}</h1>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${legendGrad}
  <rect width="${W}" height="${H}" fill="#0e0e14"/>
  ${svgAtoms}
  ${svgPath}
</svg>
<div class="legend">
  <span>φ:&nbsp;</span>
  <svg width="100" height="12"><rect width="100" height="12" fill="url(#phiGrad)"/></svg>
  <span>low → high</span>
  &nbsp;&nbsp;
  <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="#ff8800" stroke-width="2.5"/></svg>
  <span>traversal path</span>
</div>
<p style="font-size:10px;opacity:0.4">atom radius ∝ √mass · atoms: ${n} · seed: ${DOPAT_CONFIG.SEED}</p>
</body>
</html>`;

  writeFileSync(opts.out, html, "utf8");
  console.log(`Written: ${opts.out}`);

  if (opts.open) {
    const { spawn } = await import("node:child_process");
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    spawn(opener, [opts.out], { detached: true, stdio: "ignore" }).unref();
  }

  await rt.dispose();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
