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

import type { AstTriple } from "@utils/astExtract";
import { buildGraphFromAstTriples } from "./GroundGraph";
import { placeGraph, placeGraphIncremental } from "./StructuralGrounding";

export function groundAstIntoSystem(
  triples: AstTriple[],
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  opts: Grounding.AstGroundingOptions = {}
): Grounding.AstGroundingResult {
  return groundGraphIntoSystem(
    buildGraphFromAstTriples(triples),
    system,
    atomizer,
    opts
  );
}

/**
 * Lands an already-built GroundGraph into the System - the domain-agnostic core
 * shared by code (`groundAstIntoSystem`) and logic/math (`buildGraphFromLogic`).
 * One precept per unique node label; SMACOF coordinates from the graph's own
 * topology; reference in-degree -> mass. Edge KIND is irrelevant here (placement
 * and traversal read undirected hop distance), so any GroundGraph grounds the
 * same way - which is precisely the unified-domain thesis made operational.
 */
export function groundGraphIntoSystem(
  graph: Grounding.GroundGraph,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  opts: Grounding.AstGroundingOptions = {}
): Grounding.AstGroundingResult {
  const n = graph.nodes.length;
  const nodeToPrecept = new Int32Array(n).fill(-1);
  const labelToPrecept = new Map<string, number>();

  // One precept per unique node label. The whole label maps to a single scope,
  // so a dotted/multi-word identifier stays one body.
  for (let i = 0; i < n; i++) {
    const label = graph.nodes[i].label;
    // Graph terms are operands, not operators (isOperator = false).
    const scope = atomizer.getSymbolScope(label, false);
    const id = system.createLocation(system.c, scope, "ast-ground");
    nodeToPrecept[i] = id;
    labelToPrecept.set(label, id);
  }

  // Reference in-degree -> mass (centrality), computed cheaply regardless of
  // whether the full spatial placement runs.
  const inDegree = new Float64Array(n).fill(1);
  for (const e of graph.edges) inDegree[e.to] += 1;

  // Small graphs get the exact global solve; past the cap, the incremental
  // operator-anchored placer takes over (anchor skeleton + local accretion).
  const cap = opts.maxPlacementNodes ?? 3000;
  const placement =
    n === 0
      ? null
      : n <= cap
        ? placeGraph(graph, opts)
        : placeGraphIncremental(graph, opts);

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
