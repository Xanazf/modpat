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
 * A `not` anywhere in the predicate contributes no adjacency edge (mirroring
 * `Reduction.reduceEntailment`) - instead it records a signed CONTRAST pair,
 * the stance relation the placer turns into opposition on the Z axis.
 *
 * Pure module: plain data + a builder, no System or DB dependency.
 */

import { EdgeKind, NodeKind } from "@core_s/helpers/enums";
import { parseNumericLabel } from "@core_s/helpers/functions";
import { lemma } from "@skill_cogi/Reduction";

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

/**
 * Reduces a multi-word noun phrase to its HEAD (the last word - English NPs
 * are right-headed), so that one entity interns to one label no matter which
 * parser saw it.
 *
 * This exists because two parsers feed this same builder with different noun-
 * phrase conventions, and they disagreed (measured 2026-07-30, PARITY §3.2):
 * `buildGraphFromText` delegates single-clause statements to LogicGraph,
 * whose regexes hand `ensure` a RAW SPAN ("the bald eagle is red" -> subject
 * span "the bald eagle" -> lemma -> `bald eagle`), while its own grammatical
 * pass hands `ensure` a single token, because `collectNpGroups` already takes
 * the last content token of the span (`eagle`). The same animal therefore got
 * two precepts, the theory's knowledge split across them, and a question
 * landing on the sparse half was "not derivable" for reasons unrelated to the
 * theory - harmless silence under open-world semantics, a confident falsehood
 * once closed-world denial was switched on.
 *
 * Normalising HERE rather than at either call site is deliberate: `ensure` is
 * the one place both parsers meet (TextGraph's DedupGraphBuilder extends this
 * class), so the conventions cannot drift apart again.
 *
 * Known cost, accepted: the modifier is discarded, so "bald eagle" and
 * "golden eagle" would collide as `eagle`. The deduction corpora name one
 * animal of each kind per theory, so it is lossless there, and agreeing on
 * the head noun beats disagreeing about the phrase. The lossless end state is
 * to keep both labels and relate them by subsumption (derive downward from
 * `eagle` to `bald eagle`, never upward) - that is its own mechanism, not a
 * normalisation, and is deliberately not attempted here.
 *
 * Applies to Term nodes only: Operator labels are built as space-free strings
 * ("(3+4)") and Literals are excluded upstream by `parseNumericLabel`.
 *
 * Only a SIMPLE noun phrase has a single head, so spans containing a
 * coordinator or a preposition are left alone. Reducing them picks the wrong
 * word and, worse, makes a junk span collide with a real entity: delegation
 * hands `ensure` the whole subject span of "cats or dogs are pets", whose last
 * word is `dogs` - reducing it to `dog` collided with the node the
 * grammatical pass distributes to, and dedup then swallowed that disjunct's
 * softened w0.5 edge (caught by text_graph.test.ts's coordination guard).
 *
 * The test runs on the RAW span, not the lemmatised one: `lemma()` filters
 * through compromise's `.nouns()`, which drops the coordinator entirely, so
 * "cats or dogs" reaches this function already looking like a simple NP.
 */
const NP_NON_SIMPLE = /\b(?:and|or|nor|of|in|on|at|to|for|with|from|by)\b/;

function npHead(raw: string, label: string, kind: NodeKind): string {
  if (kind !== NodeKind.Term) return label;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length < 2 || NP_NON_SIMPLE.test(raw.toLowerCase())) return label;
  return words[words.length - 1];
}

export class GraphBuilder {
  private idByLabel = new Map<string, number>();
  readonly nodes: Grounding.GroundNode[] = [];
  readonly edges: Grounding.GroundEdge[] = [];
  readonly contrasts: Grounding.ContrastPair[] = [];

  /** Interns a node by label; the first kind seen for a *content* node wins
   *  unless a later, more specific kind is supplied. Numerics are always Literal. */
  ensure(rawLabel: string, kind: NodeKind): number {
    const numeric = parseNumericLabel(rawLabel);
    const label =
      numeric !== null
        ? rawLabel.trim()
        : npHead(rawLabel, lemma(rawLabel), kind);
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

  /** Records a signed stance relation (negation as opposition, not absence). */
  contrast(a: number, b: number): void {
    if (a < 0 || b < 0 || a === b) return;
    this.contrasts.push({ a, b });
  }
}

/** Returns true and adds the edge if `text` is a binary relation; else false. */
export function parseRelation(
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
    return relationOrContrast(b, m[1], m[2], edgeKind);
  }

  // Universal: "all/every <a> are/is <b>"  or bare "<a> are <b>"
  m = s.match(/^(?:all|every)\s+(.+?)\s+(?:are|is)\s+(.+)$/);
  if (!m) m = s.match(/^(.+?)\s+are\s+(.+)$/);
  if (m) {
    return relationOrContrast(b, m[1], m[2], edgeKind);
  }

  // Membership: "<x> is [a|an|the] <y>"
  m = s.match(/^(.+?)\s+is\s+(.+)$/);
  if (m) {
    return relationOrContrast(b, m[1], m[2], edgeKind);
  }

  return false;
}

/**
 * Positive predicate -> adjacency edge. Negated predicate -> a CONTRAST pair:
 * "cats are not fish" is not the absence of a relation but an opposing one,
 * and the placer puts the pair on opposite halves of the stance axis (lemma()
 * strips the "not", so the contrast lands on the bare predicate term).
 */
function relationOrContrast(
  b: GraphBuilder,
  subject: string,
  predicate: string,
  edgeKind: EdgeKind
): boolean {
  const from = b.ensure(subject, NodeKind.Term);
  const to = b.ensure(predicate, NodeKind.Term);
  if (/\bnot\b/.test(predicate)) b.contrast(from, to);
  else b.edge(from, to, edgeKind);
  return true;
}

/**
 * Parses logic/math statements into a GroundGraph. Premises become reference
 * edges (and arithmetic its containment+reduction); a `|-` conclusion becomes a
 * reduction edge from the conclusion's subject to its object - the derived fact
 * sitting downstream of what entailed it.
 */
export function buildGraphFromLogic(
  statements: string[]
): Grounding.GroundGraph {
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
  return { nodes: b.nodes, edges: b.edges, contrasts: b.contrasts };
}
