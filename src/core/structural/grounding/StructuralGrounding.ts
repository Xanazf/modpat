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

import { bfsHopDistances, undirectedAdjacency } from "./GroundGraph";

const DEFAULTS: Required<Grounding.GroundingOptions> = {
  seed: 0,
  iterations: 200,
  numberLineScale: 0.1,
  stanceScale: 4,
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
function centralityMass(g: Grounding.GroundGraph): Float64Array {
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
  g: Grounding.GroundGraph,
  opts: Required<Grounding.GroundingOptions>
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

/**
 * Solves the signed stance field over the graph: contrast-pair endpoints are
 * pinned at opposite poles (±1, sign-consistent across shared nodes - the
 * opponent of my opponent is my ally), and the rest of the graph inherits
 * stance from its neighbours by damped propagation, decaying toward neutral
 * with distance. A node adjacent to BOTH camps settles near 0 - the saddle.
 */
export function solveStanceField(
  g: Grounding.GroundGraph,
  iterations = 40
): Float64Array {
  const n = g.nodes.length;
  const s = new Float64Array(n);
  const contrasts = g.contrasts ?? [];
  if (contrasts.length === 0 || n === 0) return s;

  const pinned = new Uint8Array(n);
  for (const c of contrasts) {
    if (c.a < 0 || c.b < 0 || c.a === c.b) continue;
    if (!pinned[c.a] && !pinned[c.b]) {
      s[c.a] = 1;
      s[c.b] = -1;
    } else if (!pinned[c.a]) {
      s[c.a] = -s[c.b];
    } else if (!pinned[c.b]) {
      s[c.b] = -s[c.a];
    }
    pinned[c.a] = 1;
    pinned[c.b] = 1;
  }

  const adj = undirectedAdjacency(g);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      let acc = 0;
      let cnt = 0;
      for (const e of adj[i]) {
        acc += s[e.node];
        cnt++;
      }
      // Damped mean: stance decays toward neutral away from the poles.
      if (cnt > 0) s[i] = (acc / cnt) * 0.9;
    }
  }
  return s;
}

/** Adds the stance offset to Z when the graph carries contrast relations. */
function applyStance(
  g: Grounding.GroundGraph,
  z: Float64Array,
  opts: Required<Grounding.GroundingOptions>
): void {
  if (!g.contrasts || g.contrasts.length === 0) return;
  const s = solveStanceField(g);
  for (let i = 0; i < z.length; i++) z[i] += s[i] * opts.stanceScale;
}

/** Places a GroundGraph into 4D manifold coordinates from its own topology. */
export function placeGraph(
  g: Grounding.GroundGraph,
  options: Grounding.GroundingOptions = {}
): Grounding.Placement {
  const opts = { ...DEFAULTS, ...options };
  const n = g.nodes.length;

  const [x, y, z] = smacof3d(g, opts);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const node = g.nodes[i];
    if (node.numeric !== null) w[i] = node.numeric * opts.numberLineScale;
  }
  const mass = centralityMass(g);
  applyStance(g, z, opts);

  return { x, y, z, w, mass };
}

// -- Anchored placement (pinned live frame; free nodes relax into it) --------

/**
 * SMACOF placement where `pinned` nodes (graph index -> live [x,y,z,w]) are
 * immovable: free nodes relax against both pinned and free neighbours, so new
 * terms land in the metric frame of the precepts that already exist - the
 * live-manifold landing primitive for grammar-grounded text ingestion.
 *
 * Hop-distance targets are auto-scaled into the pinned frame: the scale is
 * the median (pinned pairwise metric distance / pinned pairwise hop distance)
 * over connected pinned pairs, so a graph whose anchors sit far apart in the
 * live manifold does not crush its free nodes between them. With fewer than
 * two connected pinned anchors the targets keep unit scale (callers apply
 * their own scale for all-fresh graphs).
 *
 * With an empty `pinned` map this reduces exactly to `placeGraph`.
 */
export function placeGraphAnchored(
  g: Grounding.GroundGraph,
  pinned: ReadonlyMap<number, readonly [number, number, number, number]>,
  options: Grounding.GroundingOptions = {}
): Grounding.Placement {
  if (pinned.size === 0) return placeGraph(g, options);

  const opts = { ...DEFAULTS, ...options };
  const n = g.nodes.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const w = new Float64Array(n);
  const mass = centralityMass(g);
  if (n === 0) return { x, y, z, w, mass };

  const adj = undirectedAdjacency(g);
  const dist: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) dist[i] = bfsHopDistances(i, adj);

  // Target scale: median metric/hop ratio over connected pinned pairs.
  const pinnedIdx = [...pinned.keys()].filter(i => i >= 0 && i < n);
  const ratios: number[] = [];
  for (let a = 0; a < pinnedIdx.length; a++) {
    for (let b = a + 1; b < pinnedIdx.length; b++) {
      const i = pinnedIdx[a];
      const j = pinnedIdx[b];
      const hop = dist[i][j];
      if (!Number.isFinite(hop) || hop === 0) continue;
      const pi = pinned.get(i)!;
      const pj = pinned.get(j)!;
      const dx = pi[0] - pj[0];
      const dy = pi[1] - pj[1];
      const dz = pi[2] - pj[2];
      const metric = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (metric > 1e-9) ratios.push(metric / hop);
    }
  }
  ratios.sort((a, b) => a - b);
  const scale = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 1;

  // Init: pinned at their live coords; free nodes at the scaled centroid of
  // their pinned neighbours (or a seeded scatter when none is reachable).
  const fixed = new Uint8Array(n);
  for (const [i, p] of pinned) {
    if (i < 0 || i >= n) continue;
    fixed[i] = 1;
    x[i] = p[0];
    y[i] = p[1];
    z[i] = p[2];
    w[i] = p[3];
  }
  const rng = makeRng(opts.seed);
  const spread = Math.max(1, Math.sqrt(n)) * scale;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of pinnedIdx) {
    cx += x[i] / pinnedIdx.length;
    cy += y[i] / pinnedIdx.length;
    cz += z[i] / pinnedIdx.length;
  }
  for (let i = 0; i < n; i++) {
    if (fixed[i]) continue;
    x[i] = cx + (rng() - 0.5) * spread;
    y[i] = cy + (rng() - 0.5) * spread;
    z[i] = cz + (rng() - 0.5) * spread;
    const numeric = g.nodes[i].numeric;
    if (numeric !== null) w[i] = numeric * opts.numberLineScale;
  }

  const eps = 1e-9;
  for (let iter = 0; iter < opts.iterations; iter++) {
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      let ax = 0;
      let ay = 0;
      let az = 0;
      let den = 0;
      const di = dist[i];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const hop = di[j];
        if (!Number.isFinite(hop) || hop === 0) continue;
        const d = hop * scale;
        const wgt = 1 / (d * d);
        const dx = x[i] - x[j];
        const dy = y[i] - y[j];
        const dz = z[i] - z[j];
        const cur = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (cur > eps) {
          const f = d / cur;
          ax += wgt * (x[j] + f * dx);
          ay += wgt * (y[j] + f * dy);
          az += wgt * (z[j] + f * dz);
        } else {
          ax += wgt * x[j];
          ay += wgt * y[j];
          az += wgt * z[j];
        }
        den += wgt;
      }
      if (den > 0) {
        x[i] = ax / den;
        y[i] = ay / den;
        z[i] = az / den;
      }
    }
  }

  // Stance offsets apply to free nodes only - pinned geometry is inviolate.
  if (g.contrasts && g.contrasts.length > 0) {
    const s = solveStanceField(g);
    for (let i = 0; i < n; i++) {
      if (!fixed[i]) z[i] += s[i] * opts.stanceScale * scale;
    }
  }

  return { x, y, z, w, mass };
}

// -- Incremental, operator-anchored placement (the O(N²) boundary, closed) ---

const INCREMENTAL_DEFAULTS: Required<Grounding.IncrementalOptions> = {
  ...DEFAULTS,
  anchorCount: 384,
  hopHorizon: 3,
  localIterations: 12,
  polishPasses: 2,
};

/**
 * Incremental, operator-anchored placement - O(K² · iters) for the K anchors
 * plus near-linear local work for everything else, instead of global SMACOF's
 * O(N² · iters). The mechanism:
 *
 *   1. Anchor skeleton - the top-K nodes by degree (plus one representative
 *      per otherwise-uncovered component) are placed by full stress
 *      majorization over their FULL-GRAPH pairwise hop distances, so the
 *      skeleton carries the global geometry.
 *   2. Local accretion - remaining nodes are placed in multi-source-BFS order
 *      from the anchor set (closest layers first, so constraints exist when a
 *      node is processed): each node relaxes ALONE against the already-placed
 *      nodes within `hopHorizon` graph hops - place new nodes against the
 *      already-settled neighbourhood, never re-running the global solve.
 *
 * Nodes unreachable from any constraint fall back to the same deterministic
 * seeded scatter global SMACOF uses for its initialization.
 */
export function placeGraphIncremental(
  g: Grounding.GroundGraph,
  options: Grounding.IncrementalOptions = {}
): Grounding.Placement {
  const opts = { ...INCREMENTAL_DEFAULTS, ...options };
  const n = g.nodes.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const w = new Float64Array(n);
  const mass = centralityMass(g);
  for (let i = 0; i < n; i++) {
    const node = g.nodes[i];
    if (node.numeric !== null) w[i] = node.numeric * opts.numberLineScale;
  }
  if (n === 0) return { x, y, z, w, mass };

  const adj = undirectedAdjacency(g);
  const rng = makeRng(opts.seed);
  const spread = Math.max(1, Math.sqrt(n));

  // -- 1. anchor selection: top-degree nodes + component coverage -----------
  const degree = new Float64Array(n);
  for (const e of g.edges) {
    if (e.from === e.to) continue;
    degree[e.from] += 1;
    degree[e.to] += 1;
  }
  const byDegree = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => degree[b] - degree[a] || a - b
  );
  const K = Math.min(opts.anchorCount, n);
  const isAnchor = new Uint8Array(n);
  const anchors: number[] = [];
  for (let k = 0; k < K; k++) {
    isAnchor[byDegree[k]] = 1;
    anchors.push(byDegree[k]);
  }
  // Components with no anchor get their highest-degree node as one, so every
  // connected region has at least one globally-placed representative.
  {
    const seen = new Uint8Array(n);
    const queue: number[] = [...anchors];
    for (const a of anchors) seen[a] = 1;
    while (queue.length > 0) {
      const u = queue.pop()!;
      for (const e of adj[u]) {
        if (!seen[e.node]) {
          seen[e.node] = 1;
          queue.push(e.node);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      // Flood this uncovered component, find its top-degree node.
      let best = i;
      const comp: number[] = [i];
      seen[i] = 1;
      for (let qi = 0; qi < comp.length; qi++) {
        const u = comp[qi];
        if (
          degree[u] > degree[best] ||
          (degree[u] === degree[best] && u < best)
        )
          best = u;
        for (const e of adj[u]) {
          if (!seen[e.node]) {
            seen[e.node] = 1;
            comp.push(e.node);
          }
        }
      }
      isAnchor[best] = 1;
      anchors.push(best);
    }
  }

  // -- 2. anchor skeleton: full SMACOF over full-graph anchor distances ------
  const m = anchors.length;
  const anchorIndex = new Int32Array(n).fill(-1);
  for (let k = 0; k < m; k++) anchorIndex[anchors[k]] = k;
  const aDist: Float64Array[] = new Array(m);
  for (let k = 0; k < m; k++) {
    const full = bfsHopDistances(anchors[k], adj);
    const row = new Float64Array(m);
    for (let l = 0; l < m; l++) row[l] = full[anchors[l]];
    aDist[k] = row;
  }
  const ax = new Float64Array(m);
  const ay = new Float64Array(m);
  const az = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    ax[k] = (rng() - 0.5) * spread;
    ay[k] = (rng() - 0.5) * spread;
    az[k] = (rng() - 0.5) * spread;
  }
  const eps = 1e-9;
  for (let iter = 0; iter < opts.iterations; iter++) {
    for (let k = 0; k < m; k++) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let den = 0;
      const dk = aDist[k];
      for (let l = 0; l < m; l++) {
        if (l === k) continue;
        const d = dk[l];
        if (!Number.isFinite(d) || d === 0) continue;
        const wgt = 1 / (d * d);
        const dx = ax[k] - ax[l];
        const dy = ay[k] - ay[l];
        const dz = az[k] - az[l];
        const cur = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (cur > eps) {
          const f = d / cur;
          sx += wgt * (ax[l] + f * dx);
          sy += wgt * (ay[l] + f * dy);
          sz += wgt * (az[l] + f * dz);
        } else {
          sx += wgt * ax[l];
          sy += wgt * ay[l];
          sz += wgt * az[l];
        }
        den += wgt;
      }
      if (den > 0) {
        ax[k] = sx / den;
        ay[k] = sy / den;
        az[k] = sz / den;
      }
    }
  }
  const placed = new Uint8Array(n);
  for (let k = 0; k < m; k++) {
    const i = anchors[k];
    x[i] = ax[k];
    y[i] = ay[k];
    z[i] = az[k];
    placed[i] = 1;
  }

  // -- 3. local accretion in multi-source-BFS order from the anchors ---------
  const layer = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  {
    const queue: number[] = [...anchors];
    for (const a of anchors) layer[a] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const e of adj[u]) {
        if (!Number.isFinite(layer[e.node])) {
          layer[e.node] = layer[u] + 1;
          queue.push(e.node);
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i)
    .filter(i => !placed[i])
    .sort((a, b) => layer[a] - layer[b] || a - b);

  // Scratch buffers for the per-node constraint BFS.
  const cNodes: number[] = [];
  const cDist: number[] = [];
  const visited = new Int32Array(n).fill(-1);
  const hopOf = new Int32Array(n);

  /** Collects placed nodes within hopHorizon of i into cNodes/cDist. */
  const collectConstraints = (i: number): void => {
    cNodes.length = 0;
    cDist.length = 0;
    const queue: number[] = [i];
    visited[i] = i;
    hopOf[i] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      const du = hopOf[u];
      if (du >= opts.hopHorizon) continue;
      for (const e of adj[u]) {
        const v = e.node;
        if (visited[v] === i) continue;
        visited[v] = i;
        hopOf[v] = du + 1;
        queue.push(v);
        if (placed[v] && v !== i) {
          cNodes.push(v);
          cDist.push(du + 1);
        }
      }
    }
  };

  /** Relaxes node i alone against the collected constraints. */
  const relaxNode = (i: number): void => {
    for (let iter = 0; iter < opts.localIterations; iter++) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let den = 0;
      for (let c = 0; c < cNodes.length; c++) {
        const j = cNodes[c];
        const d = cDist[c];
        const wgt = 1 / (d * d);
        const dx = x[i] - x[j];
        const dy = y[i] - y[j];
        const dz = z[i] - z[j];
        const cur = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (cur > eps) {
          const f = d / cur;
          sx += wgt * (x[j] + f * dx);
          sy += wgt * (y[j] + f * dy);
          sz += wgt * (z[j] + f * dz);
        } else {
          sx += wgt * x[j];
          sy += wgt * y[j];
          sz += wgt * z[j];
        }
        den += wgt;
      }
      if (den > 0) {
        x[i] = sx / den;
        y[i] = sy / den;
        z[i] = sz / den;
      }
    }
  };

  for (const i of order) {
    collectConstraints(i);

    if (cNodes.length === 0) {
      // No placed constraint in reach: deterministic scatter (same regime as
      // global SMACOF's treatment of disconnected pairs).
      x[i] = (rng() - 0.5) * spread;
      y[i] = (rng() - 0.5) * spread;
      z[i] = (rng() - 0.5) * spread;
      placed[i] = 1;
      continue;
    }

    // Init at the inverse-square-weighted centroid of the constraints.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let cden = 0;
    for (let c = 0; c < cNodes.length; c++) {
      const j = cNodes[c];
      const wgt = 1 / (cDist[c] * cDist[c]);
      cx += wgt * x[j];
      cy += wgt * y[j];
      cz += wgt * z[j];
      cden += wgt;
    }
    x[i] = cx / cden + (rng() - 0.5) * 1e-3;
    y[i] = cy / cden + (rng() - 0.5) * 1e-3;
    z[i] = cz / cden + (rng() - 0.5) * 1e-3;

    relaxNode(i);
    placed[i] = 1;
  }

  // Polish: every node is placed now, so early-accreted nodes re-relax against
  // the constraints that did not exist when they were first placed.
  for (let pass = 0; pass < opts.polishPasses; pass++) {
    for (const i of order) {
      collectConstraints(i);
      if (cNodes.length > 0) relaxNode(i);
    }
  }

  applyStance(g, z, opts);

  return { x, y, z, w, mass };
}

/**
 * Null baseline: every coordinate randomized over the structural placement's
 * own range, so a fidelity comparison isolates the contribution of grounding.
 */
export function randomPlacement(
  g: Grounding.GroundGraph,
  seed = 12345
): Grounding.Placement {
  const n = g.nodes.length;
  const structural = placeGraph(g, { seed });
  const rng = makeRng(seed ^ 0x9e3779b9);
  const out: Grounding.Placement = {
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
