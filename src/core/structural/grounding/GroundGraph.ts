/**
 * GroundGraph - the unified structural IR that code, logic, and math share.
 *
 * All three are typed directed graphs over terms with exactly three edge kinds:
 *   - Containment: structural nesting (module->symbol, class->member, term->subterm)
 *   - Reference:   use / dependency (call, import, type annotation, premise->rule)
 *   - Reduction:   equivalence / rewrite (equality, modus ponens, arithmetic eval)
 *
 * Code is built from astExtract triples today; a formula/expression parser feeds
 * the same IR for logic and math later. This module is pure data + builders with
 * no System or DB dependency - it is the domain's own topology, captured before
 * any coordinate is assigned.
 */

import { EdgeKind, NodeKind } from "@core_s/helpers/enums";
import { parseNumericLabel, yToKind } from "@core_s/helpers/functions";
import type { AstTriple } from "@utils/astExtract";

// -- astExtract -> GroundGraph ----------------------------------------------

/** astExtract predicates that denote structural nesting rather than use. */
const CONTAINMENT_PREDICATES = new Set(["has", "exports"]);
/** Predicates that denote equivalence / rewrite (logic + math extensions). */
const REDUCTION_PREDICATES = new Set(["equals", "implies", "reduces"]);

function predicateEdgeKind(pred: string): EdgeKind {
  if (CONTAINMENT_PREDICATES.has(pred)) return EdgeKind.Containment;
  if (REDUCTION_PREDICATES.has(pred)) return EdgeKind.Reduction;
  return EdgeKind.Reference;
}

/**
 * Infers the kind of an edge's object node from the predicate, since
 * astExtract's kindY hint describes the subject, not the object.
 */
function objectKindFor(pred: string): NodeKind {
  switch (pred) {
    case "calls":
      return NodeKind.Function;
    case "is":
    case "accepts":
    case "returns":
    case "extends":
    case "implements":
      return NodeKind.Type;
    case "has":
    case "exports":
      return NodeKind.Variable;
    default:
      return NodeKind.Term;
  }
}

/**
 * Builds a GroundGraph from astExtract triples. Node identity is by label;
 * the subject's kindY hint is authoritative for its kind, objects are inferred
 * from the predicate unless they appear as a subject elsewhere.
 */
export function buildGraphFromAstTriples(
  triples: AstTriple[]
): Grounding.GroundGraph {
  const idByLabel = new Map<string, number>();
  const nodes: Grounding.GroundNode[] = [];

  const ensure = (label: string, kindGuess: NodeKind): number => {
    let id = idByLabel.get(label);
    if (id === undefined) {
      id = nodes.length;
      idByLabel.set(label, id);
      nodes.push({
        id,
        label,
        kind: kindGuess,
        numeric: parseNumericLabel(label),
      });
    }
    return id;
  };

  const edges: Grounding.GroundEdge[] = [];
  for (const t of triples) {
    const subjectKind = yToKind(t.kindY);
    const sId = ensure(t.subject, subjectKind);
    // Subject kindY is authoritative - overwrite any earlier object guess.
    nodes[sId].kind = subjectKind;
    const oId = ensure(t.object, objectKindFor(t.predicate));
    if (sId === oId) continue;
    edges.push({
      from: sId,
      to: oId,
      kind: predicateEdgeKind(t.predicate),
      weight: t.energy > 0 ? t.energy : 1.0,
    });
  }

  return { nodes, edges };
}

// -- Graph utilities ---------------------------------------------------------

/** Undirected adjacency list keyed by node id (both edge directions present). */
export function undirectedAdjacency(
  g: Grounding.GroundGraph
): Grounding.AdjacencyEntry[][] {
  const adj: Grounding.AdjacencyEntry[][] = g.nodes.map(() => []);
  for (const e of g.edges) {
    adj[e.from].push({ node: e.to, weight: e.weight, kind: e.kind });
    adj[e.to].push({ node: e.from, weight: e.weight, kind: e.kind });
  }
  return adj;
}

/**
 * Unweighted shortest-path (hop) distances from `source` over undirected
 * adjacency. Unreachable nodes are left as Infinity.
 */
export function bfsHopDistances(
  source: number,
  adj: Grounding.AdjacencyEntry[][]
): Float64Array {
  const dist = new Float64Array(adj.length).fill(Number.POSITIVE_INFINITY);
  dist[source] = 0;
  const queue = [source];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const du = dist[u];
    for (const { node: v } of adj[u]) {
      if (dist[v] === Number.POSITIVE_INFINITY) {
        dist[v] = du + 1;
        queue.push(v);
      }
    }
  }
  return dist;
}
