/**
 * StructuralGrounding - assigns manifold coordinates from a GroundGraph's own
 * topology, NOT from a statistical embedding. This is the direct grounding
 * channel.
 *
 * Position EMERGES from the graph metric rather than being imposed axis-by-axis.
 * An early attempt pinned posY=kind and posZ=depth directly; measurement showed
 * that hurt faithfulness, because graph-adjacent terms of different kinds (a
 * class and its method; a function and its return type) were forced apart. The
 * thesis makes faithfulness paramount, so the spatial axes (X,Y,Z) are produced
 * by multidimensional stress majorization (SMACOF) over graph distance: terms
 * that are close in the graph become close in the manifold. Kind, depth, and
 * centrality then emerge from the layout rather than being stamped onto it.
 *
 * The W axis is reserved for the number line: numeric literals get posW = n×0.1,
 * exactly as the existing manifold encodes numerals.
 *
 * Pure module - plain Float64Arrays, independent of System, so the grounding
 * mechanism can be measured in isolation before the live pipeline is rewired.
 */

import {
  bfsHopDistances,
  type GroundGraph,
  undirectedAdjacency,
} from "./GroundGraph";

export interface Placement {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  w: Float64Array;
  mass: Float64Array;
}

export interface GroundingOptions {
  /** Deterministic seed for the initial layout. */
  seed?: number;
  /** Stress-majorization iterations. */
  iterations?: number;
  /** posW scale for numeric literals (the number line uses 0.1). */
  numberLineScale?: number;
}

const DEFAULTS: Required<GroundingOptions> = {
  seed: 0,
  iterations: 200,
  numberLineScale: 0.1,
};

/** Local mulberry32 so layout determinism never touches the global PRNG state. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference in-degree as a centrality proxy for mass. */
function centralityMass(g: GroundGraph): Float64Array {
  const mass = new Float64Array(g.nodes.length).fill(1);
  for (const e of g.edges) mass[e.to] += 1;
  return mass;
}

/**
 * 3-D SMACOF: place nodes so spatial distance matches graph hop distance.
 * Guttman transform with weights w_ij = 1/d_ij^2; disconnected pairs impose no
 * constraint. In-place (Gauss-Seidel) updates for faster convergence.
 */
function smacof3d(
  g: GroundGraph,
  opts: Required<GroundingOptions>
): [Float64Array, Float64Array, Float64Array] {
  const n = g.nodes.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  if (n === 0) return [x, y, z];

  const rng = makeRng(opts.seed);
  const spread = Math.max(1, Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    x[i] = (rng() - 0.5) * spread;
    y[i] = (rng() - 0.5) * spread;
    z[i] = (rng() - 0.5) * spread;
  }

  const adj = undirectedAdjacency(g);
  const dist: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) dist[i] = bfsHopDistances(i, adj);

  const eps = 1e-9;
  for (let iter = 0; iter < opts.iterations; iter++) {
    for (let i = 0; i < n; i++) {
      let ax = 0;
      let ay = 0;
      let az = 0;
      let den = 0;
      const di = dist[i];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d = di[j];
        if (!Number.isFinite(d) || d === 0) continue;
        const w = 1 / (d * d);
        const dx = x[i] - x[j];
        const dy = y[i] - y[j];
        const dz = z[i] - z[j];
        const cur = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (cur > eps) {
          const f = d / cur;
          ax += w * (x[j] + f * dx);
          ay += w * (y[j] + f * dy);
          az += w * (z[j] + f * dz);
        } else {
          ax += w * x[j];
          ay += w * y[j];
          az += w * z[j];
        }
        den += w;
      }
      if (den > 0) {
        x[i] = ax / den;
        y[i] = ay / den;
        z[i] = az / den;
      }
    }
  }
  return [x, y, z];
}

/** Places a GroundGraph into 4D manifold coordinates from its own topology. */
export function placeGraph(
  g: GroundGraph,
  options: GroundingOptions = {}
): Placement {
  const opts = { ...DEFAULTS, ...options };
  const n = g.nodes.length;

  const [x, y, z] = smacof3d(g, opts);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const node = g.nodes[i];
    if (node.numeric !== null) w[i] = node.numeric * opts.numberLineScale;
  }
  const mass = centralityMass(g);

  return { x, y, z, w, mass };
}

/**
 * Null baseline: every coordinate randomized over the structural placement's
 * own range, so a fidelity comparison isolates the contribution of grounding.
 */
export function randomPlacement(g: GroundGraph, seed = 12345): Placement {
  const n = g.nodes.length;
  const structural = placeGraph(g, { seed });
  const rng = makeRng(seed ^ 0x9e3779b9);
  const out: Placement = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: new Float64Array(n).fill(1),
  };
  for (const axis of ["x", "y", "z", "w"] as const) {
    const src = structural[axis];
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (src[i] < lo) lo = src[i];
      if (src[i] > hi) hi = src[i];
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
      lo = 0;
      hi = 1;
    }
    for (let i = 0; i < n; i++) out[axis][i] = lo + rng() * (hi - lo);
  }
  return out;
}
