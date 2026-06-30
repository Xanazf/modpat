/**
 * Directional W-propagation - the energetic signature of reasoning vs.
 * rationalization (NOTES.md "Rationalization vs. Reasoning - The W Dimension").
 *
 * A conclusion is supported by a set of premises. The support is a wave that
 * travels along the age axis W to reach the conclusion, and its amplitude
 * decays with how far - and in which direction - it had to travel:
 *
 *   - **Reasoning (forward).** Older premises fire first; the wave rides FORWARD
 *     along W (with the time arrow) to a newer conclusion. It pays only the
 *     distance attenuation - support far back in time is weaker, but the
 *     direction is free.
 *   - **Rationalization (backward).** The conclusion (an intent) fires first,
 *     then reaches BACKWARD along W toward older premises to justify itself. The
 *     coherence is real - the wave genuinely finds constructive nodes - but it
 *     travelled against the established-knowledge gradient, so it pays an extra
 *     amplitude penalty on top of the distance decay.
 *
 * Over the SAME support set the two differ by exactly
 * `exp(-W_BACKWARD_PENALTY · Σ|Δw|)`, so backward-gathered support is
 * *systematically* lower amplitude than forward - the falsifiable claim NOTES.md
 * stakes, here made an output property of the energy model rather than a label
 * applied after the fact.
 *
 * Pure: reads positions/field charges off the manifold, mutates nothing.
 */

import { DOPAT_CONFIG } from "@config";

export type PropagationMode = "reasoning" | "rationalization";

/** One premise's contribution to a conclusion's support amplitude. */
export interface SupportContribution {
  /** Premise precept id. */
  id: number;
  /** Field charge of the premise (the locomotion influence kernel, sans the
   *  spatial Gaussian - this is the source strength, not a distance term). */
  charge: number;
  /** |wBirth(conclusion) − wBirth(premise)|: the W-distance the wave travelled. */
  dw: number;
  /** This premise's amplitude after directional decay. */
  amplitude: number;
}

export interface InferenceAmplitude {
  mode: PropagationMode;
  /** Total support amplitude reaching the conclusion. */
  amplitude: number;
  contributions: SupportContribution[];
}

/**
 * Source strength of a precept: the same influence the locomotion force uses
 * (`density·2 + intensity·1.5 + 5`) minus the spatial Gaussian, i.e. how much
 * support this node can emit before W-distance attenuation.
 */
export function fieldCharge(system: Root.ManifoldView, id: number): number {
  return system.density[id] * 2.0 + system.intensity[id] * 1.5 + 5.0;
}

/**
 * Measures the support amplitude a conclusion accumulates from its premises,
 * propagated either forward (reasoning) or backward (rationalization) along W.
 *
 * The mode is the causal claim - which node fired first - not a property of the
 * geometry; the comparison of the two modes over the same premises is what
 * exposes the direction the wave travelled as a measurable amplitude.
 */
export function measureInferenceAmplitude(
  system: Root.ManifoldView,
  conclusionId: number,
  premiseIds: ArrayLike<number>,
  mode: PropagationMode
): InferenceAmplitude {
  const phys = DOPAT_CONFIG.PHYSICS;
  // Read the W-distance off wBirth (transaction time), NOT posW. posW is the
  // volatile freshness coordinate, re-anchored to systemAge on every vault hit
  // (System.refreshConceptAge*); using it here lets a single recall collapse the
  // measured Δw to ~0 and silently erase the reasoning-vs-rationalization signal.
  // wBirth is the stable authoring timeline this measurement requires.
  const wc = system.wBirth[conclusionId];
  const contributions: SupportContribution[] = [];
  let total = 0;

  for (let i = 0; i < premiseIds.length; i++) {
    const p = premiseIds[i];
    if (!system.isAllocated(p)) continue;
    // SIGNED Δw: δ > 0 ⇒ the conclusion is newer-born than this premise, i.e.
    // the premise sits further back along the established-knowledge timeline.
    const delta = wc - system.wBirth[p];
    const dw = Math.abs(delta);
    const charge = fieldCharge(system, p);
    // Distance attenuation along W, paid in both directions.
    let amp = charge * Math.exp(-phys.W_PROPAGATION_DECAY * dw);
    // Backward (rationalization) pays the against-the-gradient penalty, but ONLY
    // on the descending component max(0, δ) - the distance it reaches DOWN into
    // older-born knowledge. Leaning on newer-born support (δ < 0) is not a
    // rationalization move and is not penalized.
    if (mode === "rationalization") {
      amp *= Math.exp(-phys.W_BACKWARD_PENALTY * Math.max(0, delta));
    }
    total += amp;
    contributions.push({ id: p, charge, dw, amplitude: amp });
  }

  return { mode, amplitude: total, contributions };
}

/**
 * Derives the wave's propagation direction from the dual age system, rather than
 * accepting it as a caller-asserted label - the measurable property NOTES.md
 * stakes ("the direction the wave was travelling on W ... becomes a measurable
 * property of the inference").
 *
 * The origin is the node that fired most recently (highest posW freshness - the
 * local-freshness "which node fired first" signal, distinct from wBirth's stable
 * born-position). If the CONCLUSION fired last, it is an intent reaching BACK to
 * its premises ⇒ rationalization; otherwise a premise fired first and feeds the
 * conclusion FORWARD ⇒ reasoning.
 *
 * posW (volatile, re-anchored on firing) is correct here precisely because
 * firing a node updates its recency; only the *distance* term in
 * measureInferenceAmplitude must stay on the stable wBirth timeline.
 */
export function inferPropagationMode(
  system: Root.ManifoldView,
  conclusionId: number,
  premiseIds: ArrayLike<number>
): PropagationMode {
  const wConc = system.posW[conclusionId];
  let wPrem = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < premiseIds.length; i++) {
    const p = premiseIds[i];
    if (!system.isAllocated(p)) continue;
    if (system.posW[p] > wPrem) wPrem = system.posW[p];
  }
  // No allocated premises ⇒ no backward reach to speak of.
  if (wPrem === Number.NEGATIVE_INFINITY) return "reasoning";
  // STRICT: only call it rationalization when the conclusion fired strictly
  // LATER than every premise. A tie (premise and conclusion fired together) is
  // not evidence of reaching back, so it defaults to the benign forward reading.
  return wConc > wPrem ? "rationalization" : "reasoning";
}

/**
 * Maps throwaway probe atoms to the established concepts they refer to. Sequence
 * ingestion ALWAYS mints fresh precepts (SemanticAtomizer: "We ALWAYS create a
 * new location"), so a probe atom carries wBirth = now and no inference age. The
 * referent is the OLDEST prior precept of the same scope - when the system first
 * learned that symbol, i.e. its true transaction-time birth. A genuinely novel
 * token has no prior instance and keeps the probe atom (wBirth = now is correct:
 * a brand-new concept has no established age).
 */
export function resolveReferents(
  system: Root.ManifoldView,
  probeIds: ArrayLike<number>
): Uint32Array {
  const exclude = new Set<number>();
  for (let i = 0; i < probeIds.length; i++) exclude.add(probeIds[i]);

  const out = new Uint32Array(probeIds.length);
  for (let i = 0; i < probeIds.length; i++) {
    const pid = probeIds[i];
    out[i] = pid;
    if (!system.isAllocated(pid)) continue;
    const scope = system.getScope(pid);
    let bestBirth = Number.POSITIVE_INFINITY;
    for (const id of system.getIdsByScope(scope)) {
      if (exclude.has(id) || !system.isAllocated(id)) continue;
      if (system.wBirth[id] < bestBirth) {
        bestBirth = system.wBirth[id];
        out[i] = id;
      }
    }
  }
  return out;
}

/**
 * Classifies an inference by the direction that best accounts for its support.
 * Returns both amplitudes and the ratio backward/forward ∈ (0, 1]: the lower the
 * ratio, the more the support depended on reaching backward in time. The verdict
 * requires BOTH signals to agree - the derived origin says the conclusion fired
 * last (it is reaching back), AND the support is meaningfully cheaper forward.
 * A ratio of 1 means the premises are W-coincident or newer-born (no descending
 * reach to penalize).
 */
export function classifyInferenceDirection(
  system: Root.ManifoldView,
  conclusionId: number,
  premiseIds: ArrayLike<number>
): {
  forward: number;
  backward: number;
  /** backward / forward ∈ (0, 1]. */
  ratio: number;
  /** Direction derived from the dual age geometry (posW origin + wBirth). */
  derivedMode: PropagationMode;
  /** True when the conclusion fired last AND its support is cheaper forward. */
  isRationalization: boolean;
} {
  const fwd = measureInferenceAmplitude(
    system,
    conclusionId,
    premiseIds,
    "reasoning"
  ).amplitude;
  const bwd = measureInferenceAmplitude(
    system,
    conclusionId,
    premiseIds,
    "rationalization"
  ).amplitude;
  const ratio = fwd > 0 ? bwd / fwd : 1;
  const derivedMode = inferPropagationMode(system, conclusionId, premiseIds);
  return {
    forward: fwd,
    backward: bwd,
    ratio,
    derivedMode,
    isRationalization:
      derivedMode === "rationalization" &&
      ratio < DOPAT_CONFIG.PHYSICS.W_RATIONALIZATION_RATIO_THRESHOLD,
  };
}
