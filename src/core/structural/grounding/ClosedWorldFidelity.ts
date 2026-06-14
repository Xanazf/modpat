/**
 * ClosedWorldFidelity - Phase 4.5, the survey loop's CLOSED-WORLD LOGIC channel,
 * and with it the graph-domain corruption variant of the repair demonstration.
 *
 * Arithmetic and code closed the loop where the embedding homomorphism is EXACT
 * (the number line: a divergence solves to a single implied coordinate). This
 * channel is the APPROXIMATE-homomorphism case the roadmap and reviewer flagged:
 * a taxonomy / KB embeds into 3-space only up to stress, so there is no algebra
 * to invert - the repair is local RE-PLACEMENT (SMACOF over the affected
 * neighbourhood), not coordinate-solving. That is exactly reviewer prediction 1's
 * load-bearing half.
 *
 *   - TERRITORY:  the closed-world model of the KB - the transitive consequences
 *     of its reference (IS / subsumption) edges. A standard least-fixpoint
 *     reachability computation over the graph, independent of any coordinate.
 *     These consequences are NOT ingested as edges; the geometry must predict
 *     them, exactly as it must predict an un-ingested sum.
 *   - GEOMETRY predicts:  for a source X with k closed-world consequences, the
 *     placement's k nearest nodes. A faithful map places X near everything it
 *     entails and far from what it does not, so nearest-k recovers the model.
 *
 * A mis-survey (the KB recorded one relationship wrong, then placed faithfully to
 * that record) is BLIND to parse-relative fidelity - the placement IS faithful to
 * the corrupted survey - but the closed-world model of the TRUE KB exposes it: a
 * node placed by its wrong relationship is far from the consequences it really
 * has. The divergences carry that node's address; one local re-placement against
 * its TRUE neighbourhood (erosion by the river) re-validates it.
 *
 * Pure module: plain GroundGraph + Placement, no System / DB / GPU.
 */

import { EdgeKind } from "@core_s/helpers/enums";
import { bfsHopDistances, undirectedAdjacency } from "./GroundGraph";

// -- The territory: closed-world consequences ---------------------------------

/** Directed adjacency over REFERENCE edges only (IS / subsumption / name use). */
function referenceAdjacency(g: Grounding.GroundGraph): number[][] {
  const adj: number[][] = g.nodes.map(() => []);
  for (const e of g.edges) {
    if (e.kind === EdgeKind.Reference && e.from !== e.to)
      adj[e.from].push(e.to);
  }
  return adj;
}

/**
 * The closed-world model: for each node, the set of nodes reachable by following
 * reference edges (its transitive consequences - all the types it provably has).
 * Anything not reachable is, under the closed-world assumption, false. This is
 * the model check, computed from topology alone - the geometry never enters.
 */
export function closedWorldModel(
  g: Grounding.GroundGraph
): Map<number, Set<number>> {
  const refAdj = referenceAdjacency(g);
  const model = new Map<number, Set<number>>();
  for (let s = 0; s < g.nodes.length; s++) {
    const reached = new Set<number>();
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      for (const v of refAdj[queue[qi]]) {
        if (v !== s && !reached.has(v)) {
          reached.add(v);
          queue.push(v);
        }
      }
    }
    if (reached.size > 0) model.set(s, reached);
  }
  return model;
}

// -- The geometric prediction: nearest-k recovers the consequence set ---------

function distance(p: Grounding.Placement, i: number, j: number): number {
  const dx = p.x[i] - p.x[j];
  const dy = p.y[i] - p.y[j];
  const dz = p.z[i] - p.z[j];
  const dw = p.w[i] - p.w[j];
  return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
}

/**
 * Generality score: how many nodes entail v (its transitive-descendant count).
 * Strictly monotonic along entailment edges - a proper consequence of X is
 * entailed by everything that entails X, plus X itself - so it is the geometric
 * direction of "more general", and gating candidates by it is what separates a
 * term's ANCESTORS (its consequences) from its same-level SIBLINGS, which raw
 * nearest-neighbour cannot.
 */
function generality(n: number, model: Map<number, Set<number>>): Float64Array {
  const gen = new Float64Array(n);
  for (const consequences of model.values()) {
    for (const v of consequences) gen[v] += 1;
  }
  return gen;
}

/**
 * The `count` nearest nodes to `src` among candidates strictly more general than
 * it (its possible consequences), by manifold distance. The generality gate is
 * the directed half of the prediction (consequences generalize); distance is the
 * geometric half (a faithful map places a term near what it entails).
 */
function nearestConsequences(
  p: Grounding.Placement,
  src: number,
  count: number,
  n: number,
  gen: Float64Array
): Set<number> {
  const order: number[] = [];
  for (let j = 0; j < n; j++) if (j !== src && gen[j] > gen[src]) order.push(j);
  order.sort((a, b) => distance(p, src, a) - distance(p, src, b));
  return new Set(order.slice(0, count));
}

/**
 * Behavioural fidelity for closed-world logic: per source, does the geometry's
 * nearest-|model(src)| set (gated to more-general candidates) recover the
 * model's consequences? Reported as recall over all entailed pairs (precision is
 * identical since k = |model(src)|), with each missed consequence carried as a
 * divergence with its addresses.
 */
export function closedWorldFidelity(
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  model: Map<number, Set<number>> = closedWorldModel(g)
): Grounding.ClosedWorldReport {
  const n = g.nodes.length;
  const gen = generality(n, model);
  const cases: Grounding.ClosedWorldCase[] = [];
  let matched = 0;
  let total = 0;
  for (const [src, consequences] of model) {
    const predicted = nearestConsequences(p, src, consequences.size, n, gen);
    for (const target of consequences) {
      const ok = predicted.has(target);
      total++;
      if (ok) matched++;
      cases.push({
        src,
        target,
        srcLabel: g.nodes[src].label,
        targetLabel: g.nodes[target].label,
        entailed: true,
        predicted: ok,
        match: ok,
      });
    }
  }
  return {
    total,
    matched,
    fidelity: total > 0 ? matched / total : 1,
    cases,
    divergences: cases.filter(c => !c.match),
  };
}

// -- Localization: errors have addresses (the graph-domain form) --------------

/**
 * Local stress of node `id` against the TRUE graph: the mean squared mismatch
 * between its current manifold distance to each within-horizon neighbour and the
 * graph hop-distance it should sit at. A faithfully placed node (even a hub that
 * is merely hard to recall by nearest-k) has low stress; a node placed by a
 * WRONG relationship - the mis-survey - is stressed against its true
 * neighbourhood. This is the territory's signal: it reads the true graph, not
 * the survey the placement was faithful to.
 */
function localStress(
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  adj: Grounding.AdjacencyEntry[][],
  id: number,
  horizon: number
): number {
  const hop = bfsHopDistances(id, adj);
  let acc = 0;
  let cnt = 0;
  for (let j = 0; j < g.nodes.length; j++) {
    if (j === id) continue;
    const d = hop[j];
    if (!Number.isFinite(d) || d === 0 || d > horizon) continue;
    const cur = distance(p, id, j);
    const r = cur - d;
    acc += (r * r) / (d * d);
    cnt++;
  }
  return cnt > 0 ? acc / cnt : 0;
}

/**
 * Localizes the defect to a node WITH AN ADDRESS. The divergences say which
 * nodes are implicated (every failing consequence names its source and target);
 * local stress against the true graph says which of those is actually
 * mis-placed, rather than merely a hub that nearest-k cannot recall. The
 * strongest suspect is the implicated node whose placement most violates the
 * territory.
 */
export function localizeClosedWorld(
  report: Grounding.ClosedWorldReport,
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  options: { hopHorizon?: number } = {}
): Grounding.ClosedWorldSuspect[] {
  const horizon = options.hopHorizon ?? REPLACE_DEFAULTS.hopHorizon;
  const fail = new Map<number, number>();
  const pass = new Map<number, number>();
  const bump = (m: Map<number, number>, id: number) =>
    m.set(id, (m.get(id) ?? 0) + 1);
  for (const c of report.cases) {
    const m = c.match ? pass : fail;
    bump(m, c.src);
    bump(m, c.target);
  }
  const adj = undirectedAdjacency(g);
  const suspects: Grounding.ClosedWorldSuspect[] = [];
  for (const id of fail.keys()) {
    suspects.push({
      id,
      label: g.nodes[id].label,
      failCount: fail.get(id) ?? 0,
      passCount: pass.get(id) ?? 0,
      stress: localStress(g, p, adj, id, horizon),
    });
  }
  // Most stressed against the territory first; fail-count breaks ties.
  suspects.sort((a, b) => b.stress - a.stress || b.failCount - a.failCount);
  return suspects;
}

// -- Repair: local re-placement, NOT coordinate-solving -----------------------

const REPLACE_DEFAULTS = { hopHorizon: 3, iterations: 24 };

/**
 * Re-places one node where the territory says it belongs: a local SMACOF /
 * Guttman relaxation of `id`'s coordinate against the current positions of its
 * graph neighbours within `hopHorizon`, using the TRUE graph's hop distances as
 * targets. This is the graph-domain repair - there is no implied coordinate to
 * solve for (the embedding is approximate), so the node is re-embedded against
 * its neighbourhood. One node's (x,y,z) moves; nothing else does (locality of
 * writes). W is left untouched (the number line is not in play here).
 */
export function replaceNode(
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  id: number,
  options: { hopHorizon?: number; iterations?: number } = {}
): void {
  const opts = { ...REPLACE_DEFAULTS, ...options };
  const adj = undirectedAdjacency(g);
  const hop = bfsHopDistances(id, adj);

  const cNodes: number[] = [];
  const cDist: number[] = [];
  for (let j = 0; j < g.nodes.length; j++) {
    if (j === id) continue;
    const d = hop[j];
    if (Number.isFinite(d) && d > 0 && d <= opts.hopHorizon) {
      cNodes.push(j);
      cDist.push(d);
    }
  }
  if (cNodes.length === 0) return;

  // Seed at the inverse-square-weighted centroid of the neighbourhood.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let cden = 0;
  for (let c = 0; c < cNodes.length; c++) {
    const w = 1 / (cDist[c] * cDist[c]);
    cx += w * p.x[cNodes[c]];
    cy += w * p.y[cNodes[c]];
    cz += w * p.z[cNodes[c]];
    cden += w;
  }
  p.x[id] = cx / cden;
  p.y[id] = cy / cden;
  p.z[id] = cz / cden;

  const eps = 1e-9;
  for (let iter = 0; iter < opts.iterations; iter++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let den = 0;
    for (let c = 0; c < cNodes.length; c++) {
      const j = cNodes[c];
      const d = cDist[c];
      const w = 1 / (d * d);
      const dx = p.x[id] - p.x[j];
      const dy = p.y[id] - p.y[j];
      const dz = p.z[id] - p.z[j];
      const cur = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (cur > eps) {
        const f = d / cur;
        sx += w * (p.x[j] + f * dx);
        sy += w * (p.y[j] + f * dy);
        sz += w * (p.z[j] + f * dz);
      } else {
        sx += w * p.x[j];
        sy += w * p.y[j];
        sz += w * p.z[j];
      }
      den += w;
    }
    if (den > 0) {
      p.x[id] = sx / den;
      p.y[id] = sy / den;
      p.z[id] = sz / den;
    }
  }
}

/**
 * The closed-world survey loop: measure against the model, localize the strongest
 * suspect, re-place it against its TRUE neighbourhood, re-measure. Monotone - a
 * re-placement that does not reduce divergences is reverted and the loop stops.
 */
export function closedWorldSurveyLoop(
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  options: {
    maxRepairs?: number;
    model?: Map<number, Set<number>>;
    /** A suspect is repaired only if its stress exceeds this × median stress. */
    outlierFactor?: number;
  } = {}
): Grounding.ClosedWorldLoopResult {
  const maxRepairs = options.maxRepairs ?? 4;
  const model = options.model ?? closedWorldModel(g);
  const before = closedWorldFidelity(g, p, model);
  let current = before;
  const repairs: Grounding.ClosedWorldSuspect[] = [];

  const outlierFactor = options.outlierFactor ?? 3;
  // "Converged" in the APPROXIMATE domain means the detectable defect was
  // resolved (no stress outlier remains) - NOT fidelity == 1, which the
  // embedding's own stress makes unreachable. It stays false only if the loop
  // bailed on a non-improving re-placement or hit the repair cap.
  let converged = true;
  while (current.fidelity < 1 && repairs.length < maxRepairs) {
    const suspects = localizeClosedWorld(current, g, p);
    const top = suspects[0];
    if (!top || top.failCount === 0 || top.stress <= 0) break;

    // Repair only a genuine mis-survey, not embedding noise: the defective node
    // is a STRESS OUTLIER against the territory. When no node stands out (the
    // residual divergences are the approximate embedding's own limit, not a
    // defect), stop rather than chase the nearest-k metric into over-fitting.
    if (suspects.length > 1) {
      const stresses = suspects.map(s => s.stress).sort((a, b) => a - b);
      const median = stresses[Math.floor(stresses.length / 2)];
      if (median > 0 && top.stress < outlierFactor * median) break;
    }

    const savedX = p.x[top.id];
    const savedY = p.y[top.id];
    const savedZ = p.z[top.id];
    replaceNode(g, p, top.id);
    const next = closedWorldFidelity(g, p, model);
    if (next.divergences.length >= current.divergences.length) {
      p.x[top.id] = savedX;
      p.y[top.id] = savedY;
      p.z[top.id] = savedZ;
      converged = false;
      break;
    }
    repairs.push(top);
    current = next;
  }
  if (repairs.length >= maxRepairs && current.fidelity < 1) converged = false;

  return { before, after: current, repairs, converged };
}
