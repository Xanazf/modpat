import { DOPAT_CONFIG } from "@config";
import { computeCurvature } from "./Curvature";
import type { GridIndex4D } from "./GridIndex4D";

export interface SingularityCandidate {
  atomId: number;
  /** |∇φ|² / (1 + φ²) - the singularity score. */
  score: number;
}

/**
 * D1 – Scan the manifold for singularity candidates.
 *
 * Singularity condition: |∇φ|² / (1 + φ²) > SINGULARITY_THRESHOLD.
 * These are regions where many concepts collapse onto the same coordinates,
 * creating rank-deficient local geometry.
 *
 * Only detection; remediation lives in ManifoldLifecycle because it owns the
 * allocator (System.createLocation needs the TMR free-list).
 */
export function detectSingularities(
  system: Root.ManifoldView,
  grid: GridIndex4D
): SingularityCandidate[] {
  const threshold = DOPAT_CONFIG.PHYSICS.SINGULARITY_THRESHOLD;
  const candidates: SingularityCandidate[] = [];

  for (let i = 0; i < system.length; i++) {
    if (!system.isAllocated(i)) continue;

    const { phi, gradPhiSq } = computeCurvature(
      system,
      grid,
      system.posX[i],
      system.posY[i],
      system.posZ[i],
      system.posW[i]
    );

    const score = gradPhiSq / (1.0 + phi * phi);
    if (score > threshold) candidates.push({ atomId: i, score });
  }

  return candidates;
}
