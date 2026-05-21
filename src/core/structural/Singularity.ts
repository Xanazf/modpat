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

    const px = system.posX[i];
    const py = system.posY[i];
    const pz = system.posZ[i];
    const pw = system.posW[i];

    // Check if there is another allocated atom at the exact same coordinates.
    const neighbors = grid.candidatesInRadius(px, py, pz, pw, 0.1);
    let hasExactOverlap = false;
    for (const j of neighbors) {
      if (i === j) continue;
      if (!system.isAllocated(j)) continue;
      const dx = px - system.posX[j];
      const dy = py - system.posY[j];
      const dz = pz - system.posZ[j];
      const dw = pw - system.posW[j];
      const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
      if (distSq < 1e-9) {
        hasExactOverlap = true;
        break;
      }
    }

    let score = 0;
    if (hasExactOverlap) {
      score = 1000.0; // Guaranteed to exceed threshold
    } else {
      const { phi, gradPhiSq } = computeCurvature(system, grid, px, py, pz, pw);
      score = gradPhiSq / (1.0 + phi * phi);
    }

    if (score > threshold) {
      candidates.push({ atomId: i, score });
    }
  }

  return candidates;
}
