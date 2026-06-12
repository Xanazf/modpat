/**
 * MapFidelity - measures how faithfully a Placement mirrors a GroundGraph's
 * topology. This is the thesis made falsifiable: a faithful map is one where
 * graph distance and manifold distance agree.
 *
 * Two complementary measures:
 *   - pearson: correlation between graph hop-distance and manifold distance
 *     over sampled node pairs (1.0 = perfectly monotone with structure).
 *   - separation: mean(distance over non-adjacent pairs) / mean(distance over
 *     edges). > 1 means adjacent terms are closer than unrelated ones; the
 *     larger, the more the geometry encodes the graph.
 *
 * Distance is the raw Euclidean distance over the manifold axes: the placer
 * produces coherent axis scales (the spatial axes are in graph-distance units,
 * W is the number line), so no per-axis renormalization is applied - the metric
 * measures the geometry as it actually is.
 */

import { bfsHopDistances, undirectedAdjacency } from "./GroundGraph";

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(p: Grounding.Placement, i: number, j: number): number {
  const dx = p.x[i] - p.x[j];
  const dy = p.y[i] - p.y[j];
  const dz = p.z[i] - p.z[j];
  const dw = p.w[i] - p.w[j];
  return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    num += da * db;
    va += da * da;
    vb += db * db;
  }
  const den = Math.sqrt(va * vb);
  return den > 1e-12 ? num / den : 0;
}

export function mapFidelity(
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  options: Grounding.FidelityOptions = {}
): Grounding.FidelityReport {
  const n = g.nodes.length;
  const opts = {
    seed: options.seed ?? 0,
    maxPairs: options.maxPairs ?? 4000,
    separationSamples: options.separationSamples ?? 2000,
  };
  const empty: Grounding.FidelityReport = {
    pearson: 0,
    adjacentMeanDist: 0,
    nonAdjacentMeanDist: 0,
    separation: 0,
    samplePairs: 0,
  };
  if (n < 2) return empty;

  const adj = undirectedAdjacency(g);

  // Correlation: BFS from a strided set of sources, collect (gdist, mdist).
  const gd: number[] = [];
  const md: number[] = [];
  const sourceStride = Math.max(1, Math.floor(n / 64));
  for (let src = 0; src < n && gd.length < opts.maxPairs; src += sourceStride) {
    const dist = bfsHopDistances(src, adj);
    for (let j = src + 1; j < n && gd.length < opts.maxPairs; j++) {
      const d = dist[j];
      if (!Number.isFinite(d) || d === 0) continue;
      gd.push(d);
      md.push(distance(p, src, j));
    }
  }

  // Adjacent mean: over graph edges.
  const edgeKey = new Set<number>();
  let adjSum = 0;
  let adjCount = 0;
  for (const e of g.edges) {
    if (e.from === e.to) continue;
    const lo = Math.min(e.from, e.to);
    const hi = Math.max(e.from, e.to);
    edgeKey.add(lo * n + hi);
    adjSum += distance(p, e.from, e.to);
    adjCount++;
  }
  const adjacentMeanDist = adjCount > 0 ? adjSum / adjCount : 0;

  // Non-adjacent mean: random pairs that are not edges.
  const rng = makeRng(opts.seed);
  let nonSum = 0;
  let nonCount = 0;
  for (let s = 0; s < opts.separationSamples; s++) {
    const i = Math.floor(rng() * n);
    const j = Math.floor(rng() * n);
    if (i === j) continue;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    if (edgeKey.has(lo * n + hi)) continue;
    nonSum += distance(p, i, j);
    nonCount++;
  }
  const nonAdjacentMeanDist = nonCount > 0 ? nonSum / nonCount : 0;

  return {
    pearson: pearson(gd, md),
    adjacentMeanDist,
    nonAdjacentMeanDist,
    separation:
      adjacentMeanDist > 1e-9 ? nonAdjacentMeanDist / adjacentMeanDist : 0,
    samplePairs: gd.length,
  };
}
