/**
 * Coherence - turns the manifold's intrinsic diagnostics into a single score
 * for "did this traversal read as a clean geodesic through faithful terrain, or
 * did it have to force its way through?"
 *
 * This is the measurable core of Phase 2's emission gate. Three signals combine
 * CONJUNCTIVELY (a product), so any single incoherence is enough to tank the
 * score - which is what "never emit a wrong answer" requires:
 *
 *   s_effort      = exp(-w_e · effort)          winding of the path (holonomy)
 *   s_curvature   = exp(-w_c · mean|R|)          strained intrinsic geometry
 *   s_singularity = thr / max(thr, maxSing)      threaded a collapsing region
 *   score         = s_effort · s_curvature · s_singularity   ∈ (0, 1]
 *
 * The singularity signal mirrors D1 (detectSingularities): |∇φ|²/(1+φ²), plus
 * the same exact-overlap (rank-deficient) special case, so a region where
 * concepts collide is flagged the way the rest of the system already flags it.
 *
 * Pure: reads curvature from the manifold via computeCurvature; no mutation.
 * Constants live in options until calibration moves the settled values into
 * DOPAT_CONFIG.
 */

import { DOPAT_CONFIG } from "@config";
import type { GridIndex4D } from "@mutate/GridIndex4D";
import { computeCurvature } from "@props/Curvature";

export interface CoherenceOptions {
  /** s_effort = exp(-effortWeight · inferentialEffort). */
  effortWeight?: number;
  /** s_curvature = exp(-curvatureWeight · mean|R|). */
  curvatureWeight?: number;
  /** Singularity score above which the path is penalised (defaults to D1). */
  singularityThreshold?: number;
  /** score >= coherentThreshold => coherent. */
  coherentThreshold?: number;
}

export interface CoherenceReport {
  /** Overall coherence in (0,1]; 1 = clean geodesic through faithful terrain. */
  score: number;
  /** score >= coherentThreshold. */
  coherent: boolean;
  /** Holonomy effort fed in (how much the path wound). */
  inferentialEffort: number;
  /** Mean |R| (scalar curvature) over path points. */
  meanCurvature: number;
  /** Max singularity score |∇φ|²/(1+φ²) over path points. */
  maxSingularity: number;
}

/** Singularity score assigned to an exact coordinate overlap (mirrors D1). */
const OVERLAP_SINGULARITY = 1000;

function defaults(): Required<CoherenceOptions> {
  return {
    effortWeight: 1.0,
    curvatureWeight: 0.5,
    singularityThreshold: DOPAT_CONFIG.PHYSICS.SINGULARITY_THRESHOLD,
    coherentThreshold: 0.5,
  };
}

function singularityAt(
  id: number,
  system: Root.ManifoldView,
  gridIndex: GridIndex4D
): number {
  const x = system.posX[id];
  const y = system.posY[id];
  const z = system.posZ[id];
  const w = system.posW[id];

  // Rank-deficient overlap: another atom at the same coordinates (D1 rule).
  for (const j of gridIndex.candidatesInRadius(x, y, z, w, 0.1)) {
    if (j === id || !system.isAllocated(j)) continue;
    const dx = x - system.posX[j];
    const dy = y - system.posY[j];
    const dz = z - system.posZ[j];
    const dw = w - system.posW[j];
    if (dx * dx + dy * dy + dz * dz + dw * dw < 1e-9) {
      return OVERLAP_SINGULARITY;
    }
  }

  const { phi, gradPhiSq } = computeCurvature(system, gridIndex, x, y, z, w);
  return gradPhiSq / (1 + phi * phi);
}

export interface GateOptions extends CoherenceOptions {
  /** Output length above which echo detection activates. */
  longLength?: number;
  /** Echo fraction above which a long output is treated as a restatement. */
  echoLimit?: number;
  /**
   * Whether the candidate was produced by a rule-bearing mechanism (vault
   * recall, reduction, formula resolution, a real geodesic) rather than the
   * mass-ranked cluster fallback. Rule-derived short outputs are conclusions
   * and keep the short-output trust; a rule-free candidate is held to the
   * anti-echo test at ANY length - a one-token restatement of a premise is
   * still an echo, no matter how fluent. Defaults to true (the historical
   * behaviour) so callers without provenance are unchanged.
   */
  ruleDerived?: boolean;
}

export interface GateVerdict {
  /** Whether the candidate output should be emitted. */
  emit: boolean;
  /** Short label for the decision (used in diagnostics). */
  reason: "coherent" | "void" | "abstain-passthrough" | "incoherent" | "echo";
  /** Underlying coherence report (terrain signal). */
  base: CoherenceReport;
  /** Fraction of allocated output tokens whose scope appears in the input. */
  echoFrac: number;
}

function gateDefaults(): Required<GateOptions> {
  return {
    ...defaults(),
    /** Single noun ("animal") or SVO triple ("a is c") are trusted as-is. */
    longLength: 3,
    /** Beyond that, a derivation must add genuinely new tokens. */
    echoLimit: 0.7,
    ruleDerived: true,
  };
}

/**
 * Emission gate. Pure: turns a candidate output into emit/abstain by combining
 *
 *   1. terrain coherence  (`pathCoherence`)              - was the traversal clean?
 *   2. an anti-echo check (output-scope ∩ input-scope)   - is this a derivation
 *                                                         or just a restatement?
 *
 * (2) is the signal Phase 2's first calibration was missing: a cluster-matched
 * "salad" answer ("inside or the cat outside the cat") scores high on terrain
 * but is mostly re-emitted input. A reduct ("animal", "7", "a is c") either
 * introduces a new scope (a derived predicate, a number-line position) or is
 * short enough that overlap is structural rather than echoic.
 *
 * Short outputs (≤ longLength) are trusted regardless of overlap, because
 * transitive triples and atomic conclusions are legitimately built from input
 * scopes. Long outputs must clear the echo limit.
 */
export function gateEmit(
  inputIds: ArrayLike<number>,
  outputIds: ArrayLike<number>,
  system: Root.ManifoldView,
  gridIndex: GridIndex4D,
  inferentialEffort: number,
  opts: GateOptions = {}
): GateVerdict {
  const o = { ...gateDefaults(), ...opts };
  const base = pathCoherence(
    outputIds,
    system,
    gridIndex,
    inferentialEffort,
    o
  );
  const empty = { emit: false, reason: "void" as const, base, echoFrac: 0 };
  if (outputIds.length === 0) return empty;

  const inScopes = new Set<number>();
  for (let i = 0; i < inputIds.length; i++) {
    const id = inputIds[i];
    if (system.isAllocated(id)) inScopes.add(system.scope[id]);
  }

  let echo = 0;
  let valid = 0;
  for (let i = 0; i < outputIds.length; i++) {
    const id = outputIds[i];
    if (!system.isAllocated(id)) continue;
    valid++;
    if (inScopes.has(system.scope[id])) echo++;
  }
  if (valid === 0) return empty;

  const echoFrac = echo / valid;
  const isLikelyEcho =
    (valid > o.longLength || !o.ruleDerived) && echoFrac > o.echoLimit;

  if (isLikelyEcho) return { emit: false, reason: "echo", base, echoFrac };
  if (!base.coherent)
    return { emit: false, reason: "incoherent", base, echoFrac };
  return { emit: true, reason: "coherent", base, echoFrac };
}

export function pathCoherence(
  pathIds: ArrayLike<number>,
  system: Root.ManifoldView,
  gridIndex: GridIndex4D,
  inferentialEffort: number,
  opts: CoherenceOptions = {}
): CoherenceReport {
  const o = { ...defaults(), ...opts };

  let sumCurvature = 0;
  let maxSingularity = 0;
  let count = 0;
  for (let k = 0; k < pathIds.length; k++) {
    const id = pathIds[k];
    if (!system.isAllocated(id)) continue;
    const { R } = computeCurvature(
      system,
      gridIndex,
      system.posX[id],
      system.posY[id],
      system.posZ[id],
      system.posW[id]
    );
    sumCurvature += Math.abs(R);
    const sing = singularityAt(id, system, gridIndex);
    if (sing > maxSingularity) maxSingularity = sing;
    count++;
  }

  const meanCurvature = count > 0 ? sumCurvature / count : 0;
  const effort = Math.max(0, inferentialEffort);

  const sEffort = Math.exp(-o.effortWeight * effort);
  const sCurvature = Math.exp(-o.curvatureWeight * meanCurvature);
  const sSingularity =
    maxSingularity <= o.singularityThreshold
      ? 1
      : o.singularityThreshold / maxSingularity;
  const score = sEffort * sCurvature * sSingularity;

  return {
    score,
    coherent: score >= o.coherentThreshold,
    inferentialEffort: effort,
    meanCurvature,
    maxSingularity,
  };
}
