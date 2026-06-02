/**
 * Reduction - computation as traversal.
 *
 * A reduction takes a reducible state and yields its reduct as a DISTINCT,
 * DOWNSTREAM node - not an echo of the inputs. This is the mechanism that turns
 * "traverse to an answer" into "derive a correct conclusion", and the distinct-
 * downstream property is exactly the anti-echo signal Phase 2's gate lacked.
 *
 * First instance: additive arithmetic on the number line. Numbers are grounded
 * at posW = value × NUMBER_LINE_SCALE, so an operand's POSITION is its value,
 * and "A + B" is vector composition on the W axis: traverse from A's position by
 * B's position and the node you land on is the reduct. The geometry computes -
 * there is no numeric escape hatch; the operands' grounded coordinates carry the
 * values, and composing them composes the numbers.
 *
 * Pure w.r.t. logic - it only materializes the reduct node in the System.
 */

import nlp from "compromise";

/** Number-line scale: posW = value × this. Matches the atomizer convention. */
export const NUMBER_LINE_SCALE = 0.1;

export interface ReductionResult {
  /** The reduct: a freshly materialized node distinct from the operands. */
  resultId: number;
  /** Numeric value of the reduct, read back from its W position. */
  value: number;
  /** posW of the reduct (its number-line coordinate). */
  reductW: number;
  /**
   * |reductW − posW(A)|: how far the conclusion moved along the reduction axis.
   * Strictly positive for a genuine reduction; zero would mean an echo.
   */
  reductionDistance: number;
}

/** Reads the numeral a number-line position encodes. */
export function numberFromW(posW: number): number {
  return Math.round(posW / NUMBER_LINE_SCALE);
}

/**
 * Additive reduction as number-line traversal. Composes the operands' grounded
 * W positions: the reduct sits at posW(A) ± posW(B). Returns a materialized
 * node whose value is its W position; null for a non-additive operator.
 *
 * Accepts the surface forms the LogicAtomizer can emit: "+", "-", "plus",
 * "minus" - so the live perceive path can wire this in without re-parsing.
 */
export function reduceAdditive(
  operator: string,
  operandAId: number,
  operandBId: number,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): ReductionResult | null {
  const op =
    operator === "+" || operator === "plus"
      ? "+"
      : operator === "-" || operator === "minus"
        ? "-"
        : null;
  if (op === null) return null;
  if (!system.isAllocated(operandAId) || !system.isAllocated(operandBId)) {
    return null;
  }

  const wA = system.posW[operandAId];
  const wB = system.posW[operandBId];
  const composedW = op === "+" ? wA + wB : wA - wB;

  // Snap to the canonical number-line coordinate so floating-point composition
  // (0.3 + 0.4 = 0.7000000000000001) lands exactly on the integer's position.
  const value = numberFromW(composedW);
  const reductW = value * NUMBER_LINE_SCALE;

  const scope = atomizer.getSymbolScope(String(value), false);
  const resultId = system.createLocation(system.c, scope, "reduce");
  system.posX[resultId] = 0;
  system.posY[resultId] = 0;
  system.posZ[resultId] = 0;
  system.posW[resultId] = reductW;
  // Numbers are eternal number-line coordinates: decay must not drift posW.
  system.decayRate[resultId] = 0;
  system.update(resultId, "reduce");

  return {
    resultId,
    value,
    reductW,
    reductionDistance: Math.abs(reductW - wA),
  };
}

// -- Universal instantiation / IS-transitivity as IS-graph traversal --------

export interface IsRelation {
  /** Lemmatized subject. */
  subject: string;
  /** Lemmatized predicate / object. */
  object: string;
  /** True for universal rules ("all X are Y"); false for instances ("Z is X"). */
  universal: boolean;
  /** True for "is/are not" - never contributes an IS edge. */
  negated: boolean;
}

export interface EntailmentResult {
  /** Predicates reachable from the subject via IS edges (distinct from it). */
  conclusions: string[];
  /** Inference steps (hops) to each conclusion - the reduction distance. */
  hops: Map<string, number>;
  /** Conclusions that required a rule (hop >= 2): the genuinely derived facts. */
  derived: string[];
}

/** Lowercases, strips a leading article / "not", and singularizes the noun. */
export function lemma(raw: string): string {
  const w = raw
    .toLowerCase()
    .trim()
    .replace(/^(?:a|an|the)\s+/, "")
    .replace(/^not\s+/, "")
    .trim();
  if (!w) return w;
  const singular = nlp(w).nouns().toSingular().out("text").trim();
  return singular || w;
}

function relation(
  subject: string,
  object: string,
  universal: boolean
): IsRelation {
  return {
    subject: lemma(subject),
    object: lemma(object),
    universal,
    negated: /\bnot\b/.test(object),
  };
}

/**
 * Parses IS / universal facts from a statement:
 *   "all X are Y" / "every X is Y"  -> universal rule  X --is--> Y
 *   "X are Y"                        -> universal rule  X --is--> Y
 *   "Z is (a|an|the) X"              -> instance        Z --is--> X
 * "is/are not" marks the relation negated (never an edge).
 */
export function parseIsFacts(text: string): IsRelation[] {
  const out: IsRelation[] = [];
  for (const raw of text.split(/[.;]/)) {
    const s = raw.toLowerCase().trim();
    if (!s) continue;
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^(?:all|every)\s+(.+?)\s+(?:are|is)\s+(.+)$/))) {
      out.push(relation(m[1], m[2], true));
    } else if ((m = s.match(/^(.+?)\s+are\s+(.+)$/))) {
      out.push(relation(m[1], m[2], true));
    } else if ((m = s.match(/^(.+?)\s+is\s+(.+)$/))) {
      out.push(relation(m[1], m[2], false));
    }
  }
  return out;
}

/**
 * Universal instantiation as traversal: follow IS edges from `subject` through
 * its types and the rules they trigger to the predicates they entail. "tweety
 * is a bird" + "all birds are animals" => tweety reaches "animal" at two hops -
 * a distinct, downstream conclusion, never an echo of the premises. Negated
 * relations contribute no edge, so "cats are not fish" blocks "fish".
 */
export function reduceEntailment(
  subject: string,
  relations: IsRelation[]
): EntailmentResult {
  const adj = new Map<string, string[]>();
  for (const r of relations) {
    if (r.negated) continue;
    if (!adj.has(r.subject)) adj.set(r.subject, []);
    adj.get(r.subject)!.push(r.object);
  }

  const start = lemma(subject);
  const hops = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const u = queue.shift()!;
    const du = hops.get(u)!;
    for (const v of adj.get(u) ?? []) {
      if (!hops.has(v)) {
        hops.set(v, du + 1);
        queue.push(v);
      }
    }
  }
  hops.delete(start);

  const conclusions = [...hops.keys()];
  const derived = conclusions.filter(c => (hops.get(c) ?? 0) >= 2);
  return { conclusions, hops, derived };
}
