/**
 * E1 – Logical lift: resolve compound logical formulas using scope-based inference.
 *
 * Pure function: takes only atom IDs and the manifold view, returns concluded
 * atom IDs or null. No Traveler instance state is required.
 *
 * Supported inference rules:
 *   • Existential              ∀x.∃y                ⊢ y
 *   • Single-clause elim       A is not not B |-    ⊢ B  (double-neg / structural)
 *   • Modus ponens             (A ⇒ B) ∧ A          ⊢ B
 *   • Modus tollens            (A ⇒ B) ∧ ¬B         ⊢ ¬A
 *   • Universal instantiation  (∀A.B) ∧ (x is A)   ⊢ x is B
 *   • Transitivity (chained)   (A ⇒ B) ∧ (B ⇒ C)   ⊢ A ⇒ C  (follows full chain)
 *
 * Connective operators are identified by OperatorClass values; the numeric
 * constants mirror the OperatorClass enum in System.ts to avoid an import
 * cycle (this file is pure and must not import from Traveler or System).
 */

const OC_NONE = 0;
const OC_IDENTITY = 1; // IdentityShift – implies / is / are / was / can
const OC_CONJUNCTION = 2; // &&, and, but
const OC_SINK = 3; // |-, then, therefore
const OC_QUANTIFIER = 4; // exists
const OC_MODIFIER = 5; // all, every, some, for all
const OC_INVERSION = 6; // not, !

interface ParsedClause {
  antecedentScopes: Set<number>;
  antecedentIds: number[];
  consequentIds: number[];
  opId: number;
  universal: boolean;
  modifierId: number;
  isQuantifier: boolean;
  /** ID of the leading Inversion atom for negated facts ("not smoke"), or -1. */
  negationId: number;
}

/**
 * Attempt to resolve a compound logical formula from `ids` using scope-based
 * inference rules. Returns the concluded atom ID sequence, or null when no
 * rule fires (caller should fall through to the settling probe).
 */
export function resolveE1Formula(
  ids: Uint32Array,
  system: Root.ManifoldView
): Uint32Array | null {
  if (ids.length === 0) return null;

  // Split into AND-clauses at Conjunction and Sink tokens.
  const clauses: Uint32Array[] = [];
  let start = 0;
  for (let i = 0; i < ids.length; i++) {
    const cls = system.operatorClass[ids[i]];
    if (cls === OC_CONJUNCTION || cls === OC_SINK) {
      if (i > start) clauses.push(ids.slice(start, i));
      start = i + 1;
    }
  }
  if (start < ids.length) {
    const tail = Array.from(ids.slice(start)).filter(
      id => system.operatorClass[id] !== OC_SINK
    );
    if (tail.length > 0) clauses.push(new Uint32Array(tail));
  }

  const parsed: ParsedClause[] = [];
  for (const clause of clauses) {
    const modifierId =
      clause.length > 0 && system.operatorClass[clause[0]] === OC_MODIFIER
        ? clause[0]
        : -1;
    const universal = modifierId !== -1;
    const anteStart = universal ? 1 : 0;

    const hasQuantifier = Array.from(clause).some(
      id => system.operatorClass[id] === OC_QUANTIFIER
    );

    if (hasQuantifier) {
      const afterQuant: number[] = [];
      let past = false;
      for (const id of clause) {
        const c = system.operatorClass[id];
        if (c === OC_QUANTIFIER) {
          past = true;
          continue;
        }
        if (past && c === OC_NONE) afterQuant.push(id);
      }
      parsed.push({
        antecedentScopes: new Set(),
        antecedentIds: [],
        consequentIds: afterQuant,
        opId: -1,
        universal: false,
        modifierId: -1,
        isQuantifier: true,
        negationId: -1,
      });
      continue;
    }

    let opIdx = -1;
    for (let i = anteStart; i < clause.length; i++) {
      if (system.operatorClass[clause[i]] === OC_IDENTITY) {
        opIdx = i;
        break;
      }
    }

    if (opIdx === -1) {
      // Fact clause (no IdentityShift). Check for leading Inversion ("not X").
      let negationId = -1;
      for (const id of clause) {
        const c = system.operatorClass[id];
        if (c === OC_INVERSION) {
          negationId = id;
          break;
        }
        if (c === OC_NONE) break; // None atom first → not negated
      }
      const factIds = Array.from(clause).filter(
        id => system.operatorClass[id] === OC_NONE
      );
      parsed.push({
        antecedentScopes: new Set(factIds.map(id => system.scope[id])),
        antecedentIds: factIds,
        consequentIds: [],
        opId: -1,
        universal,
        modifierId,
        isQuantifier: false,
        negationId,
      });
      continue;
    }

    const anteIds = Array.from(clause.slice(anteStart, opIdx)).filter(
      id => system.operatorClass[id] === OC_NONE
    );
    // Consequent: strip Inversions so double-neg (not not X) simplifies to X.
    const consIds = Array.from(clause.slice(opIdx + 1)).filter(
      id => system.operatorClass[id] === OC_NONE
    );
    parsed.push({
      antecedentScopes: new Set(anteIds.map(id => system.scope[id])),
      antecedentIds: anteIds,
      consequentIds: consIds,
      opId: clause[opIdx],
      universal,
      modifierId,
      isQuantifier: false,
      negationId: -1,
    });
  }

  // Rule 0: Existential – "for all x exists y |-" → y  (works for single clause)
  const quantifiers = parsed.filter(c => c.isQuantifier);
  if (quantifiers.length > 0 && quantifiers[0].consequentIds.length > 0) {
    return new Uint32Array(quantifiers[0].consequentIds.slice(0, 1));
  }

  // Rule S: Single-clause conditional – "A is [not not] B |-" → B
  // Handles double negation elimination; the Inversion stripping in the parser
  // already collapses "not not B" → [B], so we simply return the consequent.
  if (clauses.length === 1) {
    const single = parsed[0];
    if (
      !single.isQuantifier &&
      single.opId !== -1 &&
      single.consequentIds.length > 0
    ) {
      return new Uint32Array(single.consequentIds);
    }
    return null;
  }

  const conditionals = parsed.filter(c => c.opId !== -1);
  const facts = parsed.filter(
    c => c.opId === -1 && !c.isQuantifier && c.antecedentIds.length > 0
  );

  if (conditionals.length === 0) return null;

  // Rule 1: Modus ponens – (A ⇒ B) ∧ A ⊢ B
  if (facts.length > 0) {
    const plainFacts = facts.filter(f => f.negationId === -1);
    if (plainFacts.length > 0) {
      const factScopes = new Set(
        plainFacts.flatMap(f => [...f.antecedentScopes])
      );
      for (const cond of conditionals) {
        if (cond.antecedentScopes.size === 0) continue;
        const allMatch = [...cond.antecedentScopes].every(s =>
          factScopes.has(s)
        );
        if (allMatch && cond.consequentIds.length > 0) {
          return new Uint32Array(cond.consequentIds);
        }
      }
    }

    // Rule MT: Modus tollens – (A ⇒ B) ∧ ¬B ⊢ ¬A
    const negatedFacts = facts.filter(f => f.negationId !== -1);
    if (negatedFacts.length > 0) {
      for (const negFact of negatedFacts) {
        const negScopes = negFact.antecedentScopes;
        for (const cond of conditionals) {
          const match = cond.consequentIds.some(id =>
            negScopes.has(system.scope[id])
          );
          if (match && cond.antecedentIds.length > 0) {
            return new Uint32Array([negFact.negationId, ...cond.antecedentIds]);
          }
        }
      }
    }
  }

  // Rule 2: Universal instantiation – (∀A.B) ∧ (x is A) ⊢ x is B
  const universals = conditionals.filter(c => c.universal);
  const nonUniversals = conditionals.filter(c => !c.universal);
  if (universals.length > 0 && nonUniversals.length > 0) {
    for (const inst of nonUniversals) {
      for (const univ of universals) {
        const match = inst.consequentIds.some(id =>
          univ.antecedentScopes.has(system.scope[id])
        );
        if (
          match &&
          univ.consequentIds.length > 0 &&
          inst.antecedentIds.length > 0
        ) {
          const opId = inst.opId !== -1 ? inst.opId : univ.opId;
          return new Uint32Array([
            ...inst.antecedentIds,
            opId,
            ...univ.consequentIds,
          ]);
        }
      }
    }
  }

  // Rule 3: Transitivity with full chain-following – (A ⇒ B) ∧ (B ⇒ … ⇒ Z) ⊢ A ⇒ Z
  const scopeToNext = new Map<
    number,
    {
      consIds: number[];
      opId: number;
      universal: boolean;
      modifierId: number;
    }
  >();
  for (const cond of conditionals) {
    for (const scope of cond.antecedentScopes) {
      if (!scopeToNext.has(scope)) {
        scopeToNext.set(scope, {
          consIds: cond.consequentIds,
          opId: cond.opId,
          universal: cond.universal,
          modifierId: cond.modifierId,
        });
      }
    }
  }

  for (const start of conditionals) {
    if (start.antecedentIds.length === 0) continue;

    let consIds = start.consequentIds;
    let opId = start.opId;
    let universal = start.universal;
    let modId = start.modifierId;
    const visited = new Set(start.antecedentScopes);
    let advanced = false;
    let hops = 0;

    while (hops++ < 20) {
      let found = false;
      for (const id of consIds) {
        const scope = system.scope[id];
        if (visited.has(scope)) continue;
        const next = scopeToNext.get(scope);
        if (next && next.consIds.length > 0) {
          visited.add(scope);
          consIds = next.consIds;
          universal = universal || next.universal;
          if (modId === -1 && next.modifierId !== -1) modId = next.modifierId;
          advanced = true;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (advanced) {
      const prefix = universal && modId !== -1 ? [modId] : [];
      return new Uint32Array([
        ...prefix,
        ...start.antecedentIds,
        opId,
        ...consIds,
      ]);
    }
  }

  return null;
}
