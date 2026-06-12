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
): Cognition.ReductionResult | null {
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
): Cognition.IsRelation {
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
export function parseIsFacts(text: string): Cognition.IsRelation[] {
  const out: Cognition.IsRelation[] = [];
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
 * a distinct, downstream conclusion, never an echo of the premises.
 *
 * Negation is a first-class edge, not just a blocker: a negated relation never
 * contributes a positive edge ("cats are not fish" still blocks "fish"), but a
 * positive path to its subject licenses the NEGATIVE conclusion - felix --is-->
 * cat --is-not--> fish derives "not fish" at hop 2, the negative instantiation
 * of the negative universal.
 */
export function reduceEntailment(
  subject: string,
  relations: Cognition.IsRelation[]
): Cognition.EntailmentResult {
  const adj = new Map<string, Cognition.Edge[]>();
  const negAdj = new Map<string, Cognition.Edge[]>();
  for (const r of relations) {
    const m = r.negated ? negAdj : adj;
    if (!m.has(r.subject)) m.set(r.subject, []);
    m.get(r.subject)!.push({ to: r.object, derived: r.derived === true });
  }

  const start = lemma(subject);
  const hops = new Map<string, number>([[start, 0]]);
  /** Whether the (first-found) path to a node crossed a rule-derived edge. */
  const viaRule = new Map<string, boolean>([[start, false]]);
  const queue = [start];
  while (queue.length > 0) {
    const u = queue.shift()!;
    const du = hops.get(u)!;
    const ruled = viaRule.get(u) === true;
    for (const e of adj.get(u) ?? []) {
      if (!hops.has(e.to)) {
        hops.set(e.to, du + 1);
        viaRule.set(e.to, ruled || e.derived);
        queue.push(e.to);
      }
    }
  }

  // Negative conclusions: a positive path to u plus one negated edge u -x-> v.
  const negHops = new Map<string, number>();
  const negViaRule = new Map<string, boolean>();
  for (const [u, du] of hops) {
    for (const e of negAdj.get(u) ?? []) {
      const h = du + 1;
      if (!negHops.has(e.to) || h < negHops.get(e.to)!) {
        negHops.set(e.to, h);
        negViaRule.set(e.to, viaRule.get(u) === true || e.derived);
      }
    }
  }

  hops.delete(start);
  viaRule.delete(start);

  const conclusions = [...hops.keys()];
  const derived = conclusions.filter(
    c => (hops.get(c) ?? 0) >= 2 || viaRule.get(c) === true
  );
  const negative = [...negHops.keys()];
  const derivedNegative = negative.filter(
    c => (negHops.get(c) ?? 0) >= 2 || negViaRule.get(c) === true
  );
  return { conclusions, hops, derived, negative, negHops, derivedNegative };
}

// -- Implications & disjunctions: rules that fire and lay derived edges ------

/** Normalizes an atomic clause to a comparable key ("it rains" -> "rain"). */
function clauseKey(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/\|-.*$/, "")
    .trim()
    .replace(/^(?:it|there)\s+/, "")
    .replace(/\b(?:does|do)\s+not\s+|\bnot\s+/g, "")
    .trim();
  return lemma(s);
}

/** Parses one clause: an IS-fact if it has a copula, else an atomic key. */
export function parseClause(raw: string): Cognition.Clause | null {
  const s = raw
    .toLowerCase()
    .replace(/\|-.*$/, "")
    .trim();
  if (!s) return null;
  const m = s.match(/^(?:all\s+|every\s+)?(.+?)\s+(?:is|are)\s+(.+)$/);
  if (m) {
    return {
      kind: "is",
      subject: lemma(m[1]),
      object: lemma(m[2]),
      negated: /\bnot\b/.test(m[2]),
    };
  }
  const key = clauseKey(s);
  if (!key) return null;
  return { kind: "atom", key, negated: /\bnot\b/.test(s) };
}

/**
 * Parses a full premise text into relations, implications ("if A then C"),
 * disjunctions ("either A or B" / "A or B"), and atomic assertions. The query
 * segment (the one carrying the Sink "|-") is never a premise and is skipped.
 */
export function parseStatements(text: string): Cognition.LogicFacts {
  const facts: Cognition.LogicFacts = {
    relations: [],
    implications: [],
    disjunctions: [],
    atoms: new Set(),
    negAtoms: new Set(),
  };
  for (const raw of text.split(/[.;]|&&/)) {
    const s = raw.toLowerCase().trim();
    if (!s || s.includes("|-")) continue;
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^if\s+(.+?)\s*,?\s*then\s+(.+)$/))) {
      const a = parseClause(m[1]);
      const c = parseClause(m[2]);
      if (a && c) facts.implications.push({ antecedent: a, consequent: c });
      continue;
    }
    if ((m = s.match(/^either\s+(.+?)\s+or\s+(.+)$/))) {
      const l = parseClause(m[1]);
      const r = parseClause(m[2]);
      if (l && r) facts.disjunctions.push({ left: l, right: r });
      continue;
    }
    if ((m = s.match(/^(?:all|every)\s+(.+?)\s+(?:are|is)\s+(.+)$/))) {
      facts.relations.push(relation(m[1], m[2], true));
    } else if ((m = s.match(/^(.+?)\s+are\s+(.+)$/))) {
      facts.relations.push(relation(m[1], m[2], true));
    } else if ((m = s.match(/^(.+?)\s+is\s+(.+)$/))) {
      facts.relations.push(relation(m[1], m[2], false));
    } else {
      const key = clauseKey(s);
      if (key) {
        if (/\bnot\b/.test(s)) facts.negAtoms.add(key);
        else facts.atoms.add(key);
      }
    }
  }
  return facts;
}

/** Does the clause hold in the asserted facts? */
function clauseHolds(
  c: Cognition.Clause,
  facts: Cognition.LogicFacts
): boolean {
  if (c.kind === "atom") {
    if (c.negated) return facts.negAtoms.has(c.key);
    return (
      facts.atoms.has(c.key) ||
      facts.relations.some(
        r => !r.negated && r.subject === c.key && r.object === "true"
      )
    );
  }
  return facts.relations.some(
    r =>
      r.negated === c.negated &&
      r.subject === c.subject &&
      r.object === c.object
  );
}

/** Is the clause explicitly refuted (its negation asserted)? */
function clauseRefuted(
  c: Cognition.Clause,
  facts: Cognition.LogicFacts
): boolean {
  if (c.kind === "atom") {
    if (c.negated) return facts.atoms.has(c.key);
    return facts.negAtoms.has(c.key);
  }
  return facts.relations.some(
    r =>
      r.negated !== c.negated &&
      r.subject === c.subject &&
      r.object === c.object
  );
}

/** Asserts a clause as a rule-derived fact (lays a derived edge). */
function assertClause(c: Cognition.Clause, facts: Cognition.LogicFacts): void {
  if (c.kind === "is") {
    facts.relations.push({
      subject: c.subject,
      object: c.object,
      universal: false,
      negated: c.negated,
      derived: true,
    });
    return;
  }
  if (c.negated) {
    facts.negAtoms.add(c.key);
    return;
  }
  facts.atoms.add(c.key);
  // An asserted atom is queryable: "q |-" should reach "true" via this edge.
  facts.relations.push({
    subject: c.key,
    object: "true",
    universal: false,
    negated: false,
    derived: true,
  });
}

/**
 * Fires rules to fixpoint:
 *   - modus ponens: an implication whose antecedent holds asserts its
 *     consequent (as a DERIVED edge - the rule application is the reduction);
 *   - disjunctive syllogism: a disjunction with one disjunct refuted asserts
 *     the other. A disjunction with neither refuted asserts NOTHING - "either
 *     A or B" alone licenses no pick, which is exactly the abstain case.
 * Chained discharges (hypothetical syllogism) fall out of the fixpoint.
 */
export function dischargeRules(facts: Cognition.LogicFacts): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const imp of facts.implications) {
      if (imp.discharged) continue;
      if (clauseHolds(imp.antecedent, facts)) {
        imp.discharged = true;
        assertClause(imp.consequent, facts);
        changed = true;
      }
    }
    for (const d of facts.disjunctions) {
      if (d.resolved) continue;
      if (clauseRefuted(d.left, facts)) {
        d.resolved = true;
        assertClause(d.right, facts);
        changed = true;
      } else if (clauseRefuted(d.right, facts)) {
        d.resolved = true;
        assertClause(d.left, facts);
        changed = true;
      }
    }
  }
}

/**
 * Full statement-level reduction: parse premises, fire implications and
 * disjunctions to fixpoint, then walk the (positive + negative) IS-graph from
 * the subject. The one entry point Perception's Phase 0c needs.
 */
export function reduceStatements(
  subject: string,
  text: string
): Cognition.EntailmentResult {
  const facts = parseStatements(text);
  dischargeRules(facts);
  return reduceEntailment(subject, facts.relations);
}
