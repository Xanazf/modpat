/**
 * LogicGraph - the logic/math half of the unified structural IR.
 *
 * GroundGraph (GroundGraph.ts) captures code as a typed directed graph via
 * `buildGraphFromAstTriples`. The roadmap's unified-domain thesis is that logic
 * and math are the SAME graph over terms, sharing the same three edge kinds:
 *
 *   | edge kind   | logic                       | math                        |
 *   | ----------- | --------------------------- | --------------------------- |
 *   | containment | quantifier / formula scope  | operator tree -> operands   |
 *   | reference   | premise -> rule, name use   | definition / variable use   |
 *   | reduction   | modus ponens, instantiation | arithmetic eval, equality   |
 *
 * This module parses a small but representative logic/math surface grammar into
 * exactly that IR, so the SAME StructuralGrounding / MapFidelity / TraversalFidelity
 * machinery proven on code can be measured on logic and math. Phase 1 deferred
 * this parser ("a formula/expression parser feeds the same IR later"); this is it.
 *
 * Grammar (statements separated by newline; `&&` conjoins; `|-` splits premises
 * from a conclusion):
 *   - arithmetic:   "<a> (+|-|plus|minus) <b> (=|equals) <c>"
 *                     -> operator node, CONTAINMENT op->a, op->b, REDUCTION op->c
 *   - implication:  "<p> implies <q>"                 -> REFERENCE p->q
 *   - universal:    "all <a> are <b>" | "<a> are <b>" -> REFERENCE a->b (subsumption)
 *   - membership:   "<x> is [a|an|the] <y>"           -> REFERENCE x->y
 *   - conclusion:   "... |- <s> (is|implies) <o>"     -> REDUCTION s->o (the derived
 *                     fact is co-located with what it reduces from)
 * A `not` anywhere in the predicate blocks the edge (negation is not an edge),
 * mirroring `Reduction.reduceEntailment`.
 *
 * Pure module: plain data + a builder, no System or DB dependency.
 */

import { lemma } from "@skill_cogi/Reduction";
import {
  EdgeKind,
  type GroundEdge,
  type GroundGraph,
  type GroundNode,
  NodeKind,
  parseNumericLabel,
} from "./GroundGraph";

const ARITH_SYMBOL: Record<string, string> = {
  "+": "+",
  plus: "+",
  "-": "-",
  minus: "-",
};

/** Normalises an arithmetic operator token to its canonical symbol, or null. */
function arithOp(tok: string): string | null {
  return ARITH_SYMBOL[tok.toLowerCase()] ?? null;
}

class GraphBuilder {
  private idByLabel = new Map<string, number>();
  readonly nodes: GroundNode[] = [];
  readonly edges: GroundEdge[] = [];

  /** Interns a node by label; the first kind seen for a *content* node wins
   *  unless a later, more specific kind is supplied. Numerics are always Literal. */
  ensure(rawLabel: string, kind: NodeKind): number {
    const numeric = parseNumericLabel(rawLabel);
    const label = numeric !== null ? rawLabel.trim() : lemma(rawLabel);
    if (!label) return -1;
    let id = this.idByLabel.get(label);
    if (id === undefined) {
      id = this.nodes.length;
      this.idByLabel.set(label, id);
      this.nodes.push({
        id,
        label,
        kind: numeric !== null ? NodeKind.Literal : kind,
        numeric,
      });
    }
    return id;
  }

  edge(from: number, to: number, kind: EdgeKind, weight = 1): void {
    if (from < 0 || to < 0 || from === to) return;
    this.edges.push({ from, to, kind, weight });
  }
}

/** Returns true and adds the edge if `text` is a binary relation; else false. */
function parseRelation(
  b: GraphBuilder,
  text: string,
  edgeKind: EdgeKind
): boolean {
  const s = text.toLowerCase().trim();
  if (!s) return false;

  // Arithmetic: "<a> <op> <b> (=|equals) <c>"
  const arith = s.match(
    /^(\S+)\s+(\+|-|plus|minus)\s+(\S+)\s+(?:=|equals)\s+(\S+)$/
  );
  if (arith) {
    const op = arithOp(arith[2])!;
    const a = b.ensure(arith[1], NodeKind.Literal);
    const bb = b.ensure(arith[3], NodeKind.Literal);
    const c = b.ensure(arith[4], NodeKind.Literal);
    const opNode = b.ensure(`(${arith[1]}${op}${arith[3]})`, NodeKind.Operator);
    b.edge(opNode, a, EdgeKind.Containment);
    b.edge(opNode, bb, EdgeKind.Containment);
    b.edge(opNode, c, EdgeKind.Reduction, 3);
    return true;
  }

  // Implication: "<p> implies <q>"
  let m = s.match(/^(.+?)\s+implies\s+(.+)$/);
  if (m) {
    if (/\bnot\b/.test(m[2])) return true; // negation blocks the edge
    b.edge(
      b.ensure(m[1], NodeKind.Term),
      b.ensure(m[2], NodeKind.Term),
      edgeKind
    );
    return true;
  }

  // Universal: "all/every <a> are/is <b>"  or bare "<a> are <b>"
  m = s.match(/^(?:all|every)\s+(.+?)\s+(?:are|is)\s+(.+)$/);
  if (!m) m = s.match(/^(.+?)\s+are\s+(.+)$/);
  if (m) {
    if (/\bnot\b/.test(m[2])) return true;
    b.edge(
      b.ensure(m[1], NodeKind.Term),
      b.ensure(m[2], NodeKind.Term),
      edgeKind
    );
    return true;
  }

  // Membership: "<x> is [a|an|the] <y>"
  m = s.match(/^(.+?)\s+is\s+(.+)$/);
  if (m) {
    if (/\bnot\b/.test(m[2])) return true;
    b.edge(
      b.ensure(m[1], NodeKind.Term),
      b.ensure(m[2], NodeKind.Term),
      edgeKind
    );
    return true;
  }

  return false;
}

/**
 * Parses logic/math statements into a GroundGraph. Premises become reference
 * edges (and arithmetic its containment+reduction); a `|-` conclusion becomes a
 * reduction edge from the conclusion's subject to its object - the derived fact
 * sitting downstream of what entailed it.
 */
export function buildGraphFromLogic(statements: string[]): GroundGraph {
  const b = new GraphBuilder();
  for (const raw of statements) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const [premiseSide, conclusionSide] = line.split(/\|-/);
    for (const clause of premiseSide.split(/&&/)) {
      parseRelation(b, clause, EdgeKind.Reference);
    }
    if (conclusionSide?.trim()) {
      // The entailed conclusion is a reduction edge (modus ponens / instantiation
      // co-locates the derived fact with its premises), not a fresh reference.
      parseRelation(b, conclusionSide, EdgeKind.Reduction);
    }
  }
  return { nodes: b.nodes, edges: b.edges };
}
