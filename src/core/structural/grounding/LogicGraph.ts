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
 * A modified noun phrase KEEPS its modifier and gains a subsumption edge to
 * its head: "the bald eagle is red" interns `bald eagle` plus an edge
 * `bald eagle -> eagle`. English NPs are right-headed, so the head is the last
 * word, and the edge direction is the one the ledger already uses for
 * membership ("felix is a cat" -> felix -> cat): the specific references the
 * general, never the reverse.
 *
 * This replaces a normalisation that COLLAPSED the phrase to its head
 * (2026-07-30 - 2026-07-31). The collapse existed because two parsers feed
 * this same builder and disagreed: `buildGraphFromText` delegates single-clause
 * statements to LogicGraph, whose regexes hand `ensure` a RAW SPAN ("the bald
 * eagle" -> lemma -> `bald eagle`), while its own grammatical pass handed over
 * a single token, because `collectNpGroups` took only the last content token
 * (`eagle`). The same animal got two precepts, the theory's knowledge split
 * across them, and a question landing on the sparse half was "not derivable"
 * for reasons unrelated to the theory.
 *
 * Collapsing was the cheap way to make them agree, and it cost the modifier:
 * "the bald eagle is red. the golden eagle is blue." pooled BOTH birds onto
 * `eagle`, so the ledger held eagle->red and eagle->blue for what the text says
 * are two animals. Harmless silence under open-world semantics; a confident
 * falsehood under closed-world denial, which is now the high-scoring
 * configuration. The parsers agree on the FULL PHRASE instead (collectNpGroups
 * emits the modified span), which is the same fix in the opposite direction -
 * and lossless, so nothing downstream has to guess what was discarded.
 *
 * Doing it HERE rather than at either call site is deliberate for the same
 * reason the collapse was: `ensure` is the one place both parsers meet
 * (TextGraph's DedupGraphBuilder extends this class), so the conventions
 * cannot drift apart again, and delegation gets the subsumption edge without
 * knowing it exists.
 *
 * Applies to Term nodes only: Operator labels are built as space-free strings
 * ("(3+4)") and Literals are excluded upstream by `parseNumericLabel`.
 *
 * Only a SIMPLE noun phrase has a single head, so spans containing a
 * coordinator or a preposition get no edge - their last word is not what they
 * are about. Delegation hands `ensure` the whole subject span of "cats or dogs
 * are pets", whose last word is `dogs`; relating that span to `dog` would
 * assert a subsumption the sentence never made.
 *
 * The test runs on the RAW span, not the lemmatised one: `lemma()` filters
 * through compromise's `.nouns()`, which drops the coordinator entirely, so
 * "cats or dogs" reaches this function already looking like a simple NP.
 */
const NP_NON_SIMPLE = /\b(?:and|or|nor|of|in|on|at|to|for|with|from|by)\b/;

/** The head of a simple modified NP, or null when there is no modifier to
 *  relate ("eagle") or the span is not a simple NP ("cats or dogs"). */
function npHead(raw: string, label: string, kind: NodeKind): string | null {
  if (kind !== NodeKind.Term) return null;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length < 2 || NP_NON_SIMPLE.test(raw.toLowerCase())) return null;
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
    const label = numeric !== null ? rawLabel.trim() : lemma(rawLabel);
    if (!label) return -1;
    const known = this.idByLabel.get(label);
    if (known !== undefined) return known;

    const id = this.nodes.length;
    this.idByLabel.set(label, id);
    this.nodes.push({
      id,
      label,
      kind: numeric !== null ? NodeKind.Literal : kind,
      numeric,
    });

    // Relate a modified NP to its head ON CREATION only, so the edge is added
    // exactly once however many times the phrase is mentioned. Interning the
    // head first would recurse forever were the head itself multi-word; it
    // never is, being one word by construction.
    if (numeric === null) {
      const head = npHead(rawLabel, label, kind);
      if (head) {
        const headId = this.ensure(head, kind);
        const before = this.definitional;
        this.definitional = true;
        this.edge(id, headId, EdgeKind.Reference);
        this.definitional = before;
      }
    }
    return id;
  }

  /**
   * While true, created edges are stamped `definitional` - derived from a
   * label, not asserted by a sentence (see GroundEdge.definitional).
   */
  protected definitional = false;

  edge(from: number, to: number, kind: EdgeKind, weight = 1): void {
    if (from < 0 || to < 0 || from === to) return;
    const e: Grounding.GroundEdge = { from, to, kind, weight };
    if (this.definitional) e.definitional = true;
    this.edges.push(e);
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
