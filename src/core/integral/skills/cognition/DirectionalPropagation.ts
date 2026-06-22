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
  /** |posW(conclusion) − posW(premise)|: the W-distance the wave travelled. */
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
  const wc = system.posW[conclusionId];
  const contributions: SupportContribution[] = [];
  let total = 0;

  for (let i = 0; i < premiseIds.length; i++) {
    const p = premiseIds[i];
    if (!system.isAllocated(p)) continue;
    const dw = Math.abs(wc - system.posW[p]);
    const charge = fieldCharge(system, p);
    // Distance attenuation along W, paid in both directions.
    let amp = charge * Math.exp(-phys.W_PROPAGATION_DECAY * dw);
    // Backward (rationalization) pays the extra against-the-gradient penalty.
    if (mode === "rationalization") {
      amp *= Math.exp(-phys.W_BACKWARD_PENALTY * dw);
    }
    total += amp;
    contributions.push({ id: p, charge, dw, amplitude: amp });
  }

  return { mode, amplitude: total, contributions };
}

/**
 * Classifies an inference by the direction that best accounts for its support.
 * Returns both amplitudes and the ratio backward/forward ∈ (0, 1]: the lower the
 * ratio, the more the support depended on reaching backward in time, i.e. the
 * more the inference reads as rationalization. A ratio of 1 means the premises
 * are W-coincident with the conclusion (no direction to distinguish).
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
  /** True when the support is meaningfully cheaper found forward. */
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
  return {
    forward: fwd,
    backward: bwd,
    ratio,
    isRationalization:
      ratio < DOPAT_CONFIG.PHYSICS.W_RATIONALIZATION_RATIO_THRESHOLD,
  };
}
