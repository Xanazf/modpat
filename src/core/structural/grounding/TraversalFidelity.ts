/**
 * TraversalFidelity - the DYNAMIC counterpart of MapFidelity.
 *
 * MapFidelity asks: does manifold *distance* mirror graph distance? (a static
 * property of the placement.) TraversalFidelity asks the load-bearing question
 * of the thesis: when the Traveler actually *moves* between two grounded
 * precepts, does the emitted geodesic path track the graph geodesic - i.e. does
 * each hop get graph-closer to the target, along real edges, rather than
 * wandering to mass-near-but-graph-distant nodes?
 *
 * "A coherent geodesic through a faithful map IS a correct inference" is only
 * true if traversal respects the structure the map encodes. P1 proved the map
 * is faithful; this proves (or refutes) that traversal of it is faithful too.
 *
 * Pure module: it takes the graph, the node->precept mapping, and a `traverse`
 * callback (so it needs no System/Traveler import), then scores the paths the
 * callback returns against the graph's own BFS geodesics.
 */

import { bfsHopDistances, undirectedAdjacency } from "./GroundGraph";

export type TraverseFn = (
  srcPrecept: number,
  tgtPrecept: number
) => Promise<Uint32Array> | Uint32Array;

const EMPTY: Grounding.TraversalFidelityReport = {
  pairs: 0,
  reachRate: 0,
  monotonicity: 0,
  onPathRate: 0,
  meanGraphNodes: 0,
  pathRate: 0,
};

/** Recovers the in-order, consecutive-deduped graph-node sequence of a path. */
function recoverNodeSequence(
  path: Uint32Array,
  preceptToNode: Map<number, number>
): number[] {
  const seq: number[] = [];
  for (const precept of path) {
    const node = preceptToNode.get(precept);
    if (node === undefined) continue;
    if (seq.length === 0 || seq[seq.length - 1] !== node) seq.push(node);
  }
  return seq;
}

export async function traversalFidelity(
  g: Grounding.GroundGraph,
  nodeToPrecept: Int32Array,
  traverse: TraverseFn,
  options: Grounding.TraversalFidelityOptions = {}
): Promise<Grounding.TraversalFidelityReport> {
  const n = g.nodes.length;
  if (n < 2) return EMPTY;
  const maxPairs = options.maxPairs ?? 64;
  const minGraphDist = options.minGraphDist ?? 2;

  const adj = undirectedAdjacency(g);
  const preceptToNode = new Map<number, number>();
  for (let node = 0; node < n; node++) {
    const p = nodeToPrecept[node];
    if (p >= 0) preceptToNode.set(p, node);
  }

  // Deterministic strided pair selection over reachable, far-enough pairs.
  const pairs: Array<[src: number, tgt: number, dist: number]> = [];
  const stride = Math.max(1, Math.floor(n / 32));
  for (let src = 0; src < n && pairs.length < maxPairs; src += stride) {
    if (nodeToPrecept[src] < 0) continue;
    const distFromSrc = bfsHopDistances(src, adj);
    for (let tgt = 0; tgt < n && pairs.length < maxPairs; tgt++) {
      if (tgt === src || nodeToPrecept[tgt] < 0) continue;
      const d = distFromSrc[tgt];
      if (Number.isFinite(d) && d >= minGraphDist) pairs.push([src, tgt, d]);
    }
  }
  if (pairs.length === 0) return EMPTY;

  let reached = 0;
  let pathProducing = 0;
  let monotonicitySum = 0;
  let graphNodesSum = 0;
  let onPathHits = 0;
  let interiorTotal = 0;

  for (const [src, tgt, graphDist] of pairs) {
    const distFromSrc = bfsHopDistances(src, adj);
    const distToTgt = bfsHopDistances(tgt, adj);
    const path = await traverse(nodeToPrecept[src], nodeToPrecept[tgt]);
    const seq = recoverNodeSequence(path, preceptToNode);
    graphNodesSum += seq.length;

    if (seq.includes(tgt)) reached++;

    if (seq.length >= 2) {
      pathProducing++;
      let decreasing = 0;
      for (let k = 0; k + 1 < seq.length; k++) {
        if (distToTgt[seq[k + 1]] < distToTgt[seq[k]]) decreasing++;
      }
      monotonicitySum += decreasing / (seq.length - 1);

      // Interior nodes (exclude endpoints) lying on a shortest path.
      for (const v of seq) {
        if (v === src || v === tgt) continue;
        interiorTotal++;
        if (distFromSrc[v] + distToTgt[v] === graphDist) onPathHits++;
      }
    }
  }

  return {
    pairs: pairs.length,
    reachRate: reached / pairs.length,
    monotonicity: pathProducing > 0 ? monotonicitySum / pathProducing : 0,
    onPathRate: interiorTotal > 0 ? onPathHits / interiorTotal : 0,
    meanGraphNodes: graphNodesSum / pairs.length,
    pathRate: pathProducing / pairs.length,
  };
}
