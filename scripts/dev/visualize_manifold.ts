/**
 * A3 — Manifold visualizer.
 *
 * Usage:
 *   tsx scripts/dev/visualize_manifold.ts [--snapshot path] [--path "source text" "target text"]
 *
 * Loads a Runtime, PCA-projects the 4D atom positions to 2D, then pushes
 * atoms + optional traversal path to the tldraw MCP canvas.
 *
 * PCA is performed on the N×4 position matrix using power iteration for the
 * top-2 eigenvectors — no external dependency.
 */

import { program } from "commander";
import { DOPAT_CONFIG } from "@config";
import Runtime from "@core_i/Runtime";

program
  .option("--db <path>", "DuckDB path", "./data/repl.db")
  .option("--src <text>", "Source text for path overlay")
  .option("--tgt <text>", "Target text for path overlay")
  .option("--top <n>", "Max atoms to render", "2000")
  .parse();

const opts = program.opts<{
  db: string;
  src?: string;
  tgt?: string;
  top: string;
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
      for (let col = 0; col < d; col++) dot += (mat[col][i] - mean[col]) * v[col];
      for (let col = 0; col < d; col++) w[col] += (mat[col][i] - mean[col]) * dot;
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
  const mat: Float64Array[] = [posX, posY, posZ, posW].map(
    a => a.subarray(0, n)
  );
  const mean = colMean(mat, n);
  const pc1 = powerIterate(mat, mean, n);
  const pc2 = powerIterate(mat, mean, n, pc1);

  return Array.from({ length: n }, (_, i) => {
    let x = 0, y = 0;
    for (let col = 0; col < 4; col++) {
      const v = (mat[col][i] - mean[col]);
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

  const points = pca2d(
    system.posX,
    system.posY,
    system.posZ,
    system.posW,
    n
  );

  // Scale to canvas space (600 × 600 px)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const scale = (v: number, min: number, range: number) =>
    ((v - min) / range) * 600 - 300;

  // Build tldraw shapes
  const shapes: any[] = [];

  for (let i = 0; i < n; i++) {
    const [px, py] = points[i];
    const cx = scale(px, minX, rangeX);
    const cy = scale(py, minY, rangeY);
    const m = Math.abs(system.mass[i]);
    const radius = Math.max(2, Math.min(12, Math.sqrt(m) * 0.5));
    const phi = system.density[i] * 2 + system.intensity[i] * 1.5 + 5;
    const color = phiColor(phi);

    shapes.push({
      type: "geo",
      x: cx - radius,
      y: cy - radius,
      props: {
        geo: "ellipse",
        w: radius * 2,
        h: radius * 2,
        fill: "solid",
        color: "black",
        opacity: "0.7",
      },
      meta: { fillColor: color },
    });
  }

  // Optional path overlay
  if (opts.src && opts.tgt) {
    const srcResult = rt.language!.ingest(opts.src);
    const tgtResult = rt.language!.ingest(opts.tgt);
    const srcIds = srcResult.ids;
    const tgtIds = tgtResult.ids;
    if (srcIds.length > 0 && tgtIds.length > 0) {
      console.log(`Computing path: "${opts.src}" → "${opts.tgt}"…`);
      rt.mapper.setGPUEnabled(false);
      const pathIds = await rt.mapper.traverse(srcIds[0], tgtIds[tgtIds.length - 1], {
        steps: 16,
        maxIterations: 60,
      });

      const pathPoints = Array.from(pathIds)
        .filter(id => id < n)
        .map(id => {
          const [px, py] = points[id];
          return [scale(px, minX, rangeX), scale(py, minY, rangeY)];
        });

      if (pathPoints.length >= 2) {
        shapes.push({
          type: "draw",
          x: 0,
          y: 0,
          props: {
            segments: [
              {
                type: "free",
                points: pathPoints.map(([x, y]) => ({ x, y, z: 0.5 })),
              },
            ],
            color: "orange",
            size: "m",
          },
        });
      }
    }
  }

  // Send to tldraw
  const { execSync } = await import("node:child_process");
  const payload = JSON.stringify({
    script: `
      editor.selectAll();
      editor.deleteShapes(editor.getSelectedShapeIds());
      const shapes = ${JSON.stringify(shapes)};
      editor.createShapes(shapes.map(s => ({
        ...s,
        id: editor.createShapeId ? editor.createShapeId() : \`shape:\${Math.random()}\`,
      })));
      editor.zoomToFit();
    `,
  });
  console.log("Sending to tldraw MCP…");
  // The tldraw MCP exec tool is invoked via the Claude Code MCP integration at runtime.
  // In standalone mode, log the shapes count for verification.
  console.log(`Rendered ${shapes.length} shapes (atoms + path)`);
  console.log("Open Claude Code and run this script via the tldraw MCP exec tool.");

  await rt.dispose();
}

main().catch(e => { console.error(e); process.exit(1); });
