/**
 * BehaviouralFidelity - Phase 4.5, the survey loop.
 *
 * Every fidelity number before this module is PARSE-RELATIVE: mapFidelity and
 * traversalFidelity validate the manifold against the graph the manifold was
 * built from - circular by construction. A map earns "right" only by contact
 * with the territory. This module is that contact, for the domain where ground
 * truth is free: arithmetic. The geometry PREDICTS a reduct (composition on
 * the W number line); EVALUATING the expression is the territory's answer; any
 * mismatch is a terrain defect WITH AN ADDRESS (the operand precepts), so the
 * correction is local: solve the implied coordinate from the divergences,
 * re-place the defective precept, re-validate.
 *
 * Structurally this is learnCycle with the reinforcement signal re-pointed
 * from usage to ground truth - erosion by the river, not by the map-maker.
 *
 * Pure module: reads/writes only the precepts it is handed; no DB, no GPU.
 */

import { NUMBER_LINE_SCALE, numberFromW } from "@skill_cogi/Reduction";

// -- Prediction vs evaluation -------------------------------------------------

export interface ArithCase {
  /** Surface expression, e.g. "3 + 4". */
  expr: string;
  /** Operand precept ids - the ADDRESSES the error report points at. */
  aId: number;
  bId: number;
  /** Parsed operand values and operator (the territory's reading). */
  aVal: number;
  bVal: number;
  op: "+" | "-";
  /** Geometry's prediction: compose the operands' W positions. */
  predicted: number;
  /** Territory: evaluate the expression. */
  actual: number;
  match: boolean;
}

export interface BehaviouralReport {
  total: number;
  matched: number;
  /** Fraction of geometric predictions that match actual evaluation. */
  fidelity: number;
  cases: ArithCase[];
  divergences: ArithCase[];
}

/**
 * Looks up the precept grounding a numeral by scope. Returns -1 if the
 * numeral is not in the terrain.
 */
export function preceptForSymbol(
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  symbol: string
): number {
  const scope = atomizer.getSymbolScope(symbol, false);
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i) && system.scope[i] === scope) return i;
  }
  return -1;
}

/**
 * Measures behavioural fidelity over additive expressions whose results were
 * NEVER ingested: geometry predicts by composing grounded W positions, the
 * evaluator computes the truth, and the report carries every divergence with
 * the operand addresses attached.
 */
export function behaviouralFidelity(
  exprs: string[],
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): BehaviouralReport {
  const cases: ArithCase[] = [];
  for (const expr of exprs) {
    const m = expr.trim().match(/^(-?\d+)\s*([+-])\s*(-?\d+)$/);
    if (!m) continue;
    const aVal = Number(m[1]);
    const bVal = Number(m[3]);
    const op = m[2] as "+" | "-";
    const aId = preceptForSymbol(system, atomizer, m[1]);
    const bId = preceptForSymbol(system, atomizer, m[3]);
    if (aId === -1 || bId === -1) continue;

    const wA = system.posW[aId];
    const wB = system.posW[bId];
    const predicted = numberFromW(op === "+" ? wA + wB : wA - wB);
    const actual = op === "+" ? aVal + bVal : aVal - bVal;
    cases.push({
      expr,
      aId,
      bId,
      aVal,
      bVal,
      op,
      predicted,
      actual,
      match: predicted === actual,
    });
  }
  const matched = cases.filter(c => c.match).length;
  return {
    total: cases.length,
    matched,
    fidelity: cases.length > 0 ? matched / cases.length : 1,
    cases,
    divergences: cases.filter(c => !c.match),
  };
}

// -- Localization: errors have addresses --------------------------------------

export interface Suspect {
  /** The precept the divergences implicate. */
  id: number;
  /** Numeral the precept grounds (for reporting). */
  label: string;
  /** Where the corrupted survey put it. */
  currentW: number;
  /**
   * Where the territory says it belongs: the median of the W coordinate each
   * failing case independently implies for it (under a single-fault reading).
   */
  suggestedW: number;
  /** Failing cases this precept participates in. */
  failCount: number;
  /** Passing cases this precept participates in (counter-evidence). */
  passCount: number;
  /** Spread (max-min) of the implied W values; small = consistent story. */
  spread: number;
}

/**
 * Localizes divergences to the terrain region that forced the wrong path.
 * For each precept appearing in a failing case, every failing case implies a
 * corrected W for it (solve the composition for that operand, holding the
 * other fixed). A genuine mis-survey tells a CONSISTENT story: the implied
 * coordinates agree across failing cases and the precept avoids passing ones.
 */
export function localizeDivergences(
  report: BehaviouralReport,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): Suspect[] {
  const implied = new Map<number, number[]>();
  const failCount = new Map<number, number>();
  const passCount = new Map<number, number>();

  for (const c of report.cases) {
    if (c.match) {
      passCount.set(c.aId, (passCount.get(c.aId) ?? 0) + 1);
      passCount.set(c.bId, (passCount.get(c.bId) ?? 0) + 1);
      continue;
    }
    const target = c.actual * NUMBER_LINE_SCALE;
    const wA = system.posW[c.aId];
    const wB = system.posW[c.bId];

    if (c.aId === c.bId) {
      // Self-pair: both operands are the SAME precept, so the single-fault
      // solve is w = target/2 for "+" ("a - a" carries no information).
      failCount.set(c.aId, (failCount.get(c.aId) ?? 0) + 1);
      if (c.op === "+") {
        if (!implied.has(c.aId)) implied.set(c.aId, []);
        implied.get(c.aId)!.push(target / 2);
      }
      continue;
    }

    failCount.set(c.aId, (failCount.get(c.aId) ?? 0) + 1);
    failCount.set(c.bId, (failCount.get(c.bId) ?? 0) + 1);

    // a OP b = actual; solve for each operand assuming the other is sound.
    const impliedA = c.op === "+" ? target - wB : target + wB;
    const impliedB = c.op === "+" ? target - wA : wA - target;
    if (!implied.has(c.aId)) implied.set(c.aId, []);
    if (!implied.has(c.bId)) implied.set(c.bId, []);
    implied.get(c.aId)!.push(impliedA);
    implied.get(c.bId)!.push(impliedB);
  }

  const suspects: Suspect[] = [];
  for (const [id, ws] of implied) {
    ws.sort((a, b) => a - b);
    const suggestedW = ws[Math.floor(ws.length / 2)];
    suspects.push({
      id,
      label: atomizer.decodeSequence(new Uint32Array([id]), system).trim(),
      currentW: system.posW[id],
      suggestedW,
      failCount: failCount.get(id) ?? 0,
      passCount: passCount.get(id) ?? 0,
      spread: ws[ws.length - 1] - ws[0],
    });
  }

  // Strongest suspect first: most failing participations, fewest passing,
  // most consistent implied coordinate.
  suspects.sort(
    (a, b) =>
      b.failCount - a.failCount ||
      a.passCount - b.passCount ||
      a.spread - b.spread
  );
  return suspects;
}

// -- Repair: the local write --------------------------------------------------

/**
 * Repairs a mis-surveyed precept by re-placing it where the territory says it
 * belongs. This is the locality-of-writes claim made operational: the
 * correction touches ONE precept's coordinate, not the whole terrain.
 */
export function repairPrecept(
  system: Root.ManifoldView,
  id: number,
  w: number
): void {
  system.posW[id] = w;
  system.update(id, "survey-repair");
}

// -- The loop: prediction → evaluation → localization → repair → re-validate --

export interface SurveyLoopResult {
  /** Fidelity before any repair. */
  before: BehaviouralReport;
  /** Fidelity after the loop finished. */
  after: BehaviouralReport;
  /** Each repair performed: which precept moved, from where, to where. */
  repairs: Suspect[];
  /** True if the loop ended with every prediction matching the territory. */
  converged: boolean;
}

/**
 * Runs the survey loop to convergence (or maxRepairs). Each round: measure,
 * localize the strongest CONSISTENT suspect, re-place it, re-measure. Stops
 * when fidelity is 1 or no suspect tells a consistent story (spread above
 * half a number-line step would mean multiple faults aliasing each other).
 */
export function surveyLoop(
  exprs: string[],
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  options: { maxRepairs?: number } = {}
): SurveyLoopResult {
  const maxRepairs = options.maxRepairs ?? 4;
  const before = behaviouralFidelity(exprs, system, atomizer);
  let current = before;
  const repairs: Suspect[] = [];

  while (current.fidelity < 1 && repairs.length < maxRepairs) {
    const suspects = localizeDivergences(current, system, atomizer);
    // A suspect must tell a CONSISTENT story (implied coordinates agree) and
    // be corroborated by more than one divergence, unless one is all there is.
    const top = suspects.find(
      s =>
        s.spread < NUMBER_LINE_SCALE / 2 &&
        (s.failCount >= 2 || current.divergences.length === 1)
    );
    if (!top) break;
    repairPrecept(system, top.id, top.suggestedW);
    const next = behaviouralFidelity(exprs, system, atomizer);
    if (next.divergences.length >= current.divergences.length) {
      // The repair did not help: revert the write and stop rather than thrash.
      repairPrecept(system, top.id, top.currentW);
      break;
    }
    repairs.push(top);
    current = next;
  }

  return {
    before,
    after: current,
    repairs,
    converged: current.fidelity === 1,
  };
}
