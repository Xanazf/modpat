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

import type { AstTriple } from "@utils/astExtract";

export enum EdgeKind {
  /** Structural nesting: module->symbol, class->member, parent term->subterm. */
  Containment = 0,
  /** Use / dependency: call, import, type annotation, premise->rule. */
  Reference = 1,
  /** Equivalence / rewrite: equality, modus ponens, arithmetic evaluation. */
  Reduction = 2,
}

/**
 * Canonical node kinds. The numeric companion (kindToY) is the posY (Kind-axis)
 * coordinate, chosen to match astExtract's existing kindY scheme so code, logic,
 * and math stratify on the same axis.
 */
export enum NodeKind {
  Type = 0,
  Class = 1,
  Function = 2,
  Variable = 3,
  Enum = 4,
  Module = 5,
  Literal = 6,
  Operator = 7,
  Term = 8,
}

/** posY value per kind. Code kinds reuse astExtract's hints (0.0..0.9). */
const KIND_Y: Record<NodeKind, number> = {
  [NodeKind.Type]: 0.0,
  [NodeKind.Class]: 0.1,
  [NodeKind.Function]: 0.3,
  [NodeKind.Variable]: 0.6,
  [NodeKind.Enum]: 0.8,
  [NodeKind.Module]: 0.9,
  [NodeKind.Literal]: 0.5,
  [NodeKind.Operator]: 0.7,
  [NodeKind.Term]: 0.4,
};

const ALL_KINDS: NodeKind[] = [
  NodeKind.Type,
  NodeKind.Class,
  NodeKind.Function,
  NodeKind.Variable,
  NodeKind.Enum,
  NodeKind.Module,
  NodeKind.Literal,
  NodeKind.Operator,
  NodeKind.Term,
];

export function kindToY(k: NodeKind): number {
  return KIND_Y[k] ?? KIND_Y[NodeKind.Term];
}

/** Maps a posY hint (e.g. astExtract.kindY) back to the nearest NodeKind. */
export function yToKind(y: number): NodeKind {
  let best = NodeKind.Term;
  let bestD = Number.POSITIVE_INFINITY;
  for (const k of ALL_KINDS) {
    const d = Math.abs(KIND_Y[k] - y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

export interface GroundNode {
  id: number;
  label: string;
  kind: NodeKind;
  /** Parsed value when the label is a numeric literal, else null. */
  numeric: number | null;
}

export interface GroundEdge {
  from: number;
  to: number;
  kind: EdgeKind;
  /** Relative pull strength (astExtract energy, or 1.0 by default). */
  weight: number;
}

/**
 * A signed stance/antonym relation: the two nodes are mutually exclusive
 * ("modular" vs "monolithic", "cat" vs-not "fish"). NOT a fourth edge kind -
 * adjacency means attraction, and a contrast is the opposite claim: the placer
 * pushes the pair to opposite halves of the stance axis so their attractor
 * pulls genuinely oppose (a traveler between them stalls on a saddle instead
 * of being muted by crowding).
 */
export interface ContrastPair {
  a: number;
  b: number;
}

export interface GroundGraph {
  nodes: GroundNode[];
  edges: GroundEdge[];
  /** Signed stance relations; empty/absent for graphs with no negation source. */
  contrasts?: ContrastPair[];
}

/** Parses a bare numeric literal label; returns null for non-numeric labels. */
export function parseNumericLabel(label: string): number | null {
  return /^-?\d+(?:\.\d+)?$/.test(label.trim()) ? parseFloat(label) : null;
}

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
export function buildGraphFromAstTriples(triples: AstTriple[]): GroundGraph {
  const idByLabel = new Map<string, number>();
  const nodes: GroundNode[] = [];

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

  const edges: GroundEdge[] = [];
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

export interface AdjacencyEntry {
  node: number;
  weight: number;
  kind: EdgeKind;
}

/** Undirected adjacency list keyed by node id (both edge directions present). */
export function undirectedAdjacency(g: GroundGraph): AdjacencyEntry[][] {
  const adj: AdjacencyEntry[][] = g.nodes.map(() => []);
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
  adj: AdjacencyEntry[][]
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
