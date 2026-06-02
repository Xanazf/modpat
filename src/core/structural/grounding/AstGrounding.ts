/**
 * AstGrounding - lands a code graph directly into the live System with
 * coordinates derived from the graph's OWN topology, not from embeddings.
 *
 * This is the bridge from the isolated, measured grounding mechanism to the
 * running manifold. One precept per graph node (the whole label is a single
 * symbol, so "engine.start" is one body, not three tokens), positioned by
 * StructuralGrounding so graph-adjacent terms become metric-near. Reference
 * in-degree becomes mass, so hubs are heavy - the "operators are definitive"
 * weighting emerges from structure rather than being assigned.
 *
 * Callers crystallize edge proofs AFTER this returns, against the final
 * (faithful) positions, so vault anchors are never stale.
 */

import { type AstTriple } from "@utils/astExtract";
import { buildGraphFromAstTriples, type GroundGraph } from "./GroundGraph";
import {
  type GroundingOptions,
  placeGraph,
  type Placement,
} from "./StructuralGrounding";

export interface AstGroundingOptions extends GroundingOptions {
  /**
   * Global SMACOF placement is O(nodes^2 x iterations). Above this node count
   * the coordinates are skipped (mass + precepts are still created, edges still
   * crystallizable) until Phase 4 brings incremental, anchored placement that
   * scales to a whole repository.
   */
  maxPlacementNodes?: number;
}

export interface AstGroundingResult {
  graph: GroundGraph;
  /** graph node index -> System precept id (-1 if unallocated). */
  nodeToPrecept: Int32Array;
  /** node label -> System precept id, for crystallizing edge proofs. */
  labelToPrecept: Map<string, number>;
  /** Placement applied to the System, or null if the node cap was exceeded. */
  placement: Placement | null;
}

export function groundAstIntoSystem(
  triples: AstTriple[],
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  opts: AstGroundingOptions = {}
): AstGroundingResult {
  const graph = buildGraphFromAstTriples(triples);
  const n = graph.nodes.length;
  const nodeToPrecept = new Int32Array(n).fill(-1);
  const labelToPrecept = new Map<string, number>();

  // One precept per unique node label. The whole label maps to a single scope,
  // so a dotted/multi-word identifier stays one body.
  for (let i = 0; i < n; i++) {
    const label = graph.nodes[i].label;
    // Code identifiers are operands, not operators (isOperator = false).
    const scope = atomizer.getSymbolScope(label, false);
    const id = system.createLocation(system.c, scope, "ast-ground");
    nodeToPrecept[i] = id;
    labelToPrecept.set(label, id);
  }

  // Reference in-degree -> mass (centrality), computed cheaply regardless of
  // whether the full spatial placement runs.
  const inDegree = new Float64Array(n).fill(1);
  for (const e of graph.edges) inDegree[e.to] += 1;

  const cap = opts.maxPlacementNodes ?? 3000;
  const placement = n > 0 && n <= cap ? placeGraph(graph, opts) : null;

  for (let i = 0; i < n; i++) {
    const id = nodeToPrecept[i];
    if (id < 0 || !system.isAllocated(id)) continue;
    if (placement) {
      system.posX[id] = placement.x[i];
      system.posY[id] = placement.y[i];
      system.posZ[id] = placement.z[i];
      system.posW[id] = placement.w[i];
    }
    system.mass[id] = system.c * inDegree[i];
    system.update(id, "ast-ground");
  }

  return { graph, nodeToPrecept, labelToPrecept, placement };
}
