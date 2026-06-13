import { defineDemotedPath } from "../_schema";

/**
 * relaxPath, the fixed-endpoint boundary-value geodesic. Superseded by Lyapunov
 * settling at the c17b543 cutover but kept wired behind a flag for rollback and
 * for the GPU-offload geodesic test that still exercises it. Live-demoted, not
 * removed: nothing to revive from git.
 */
export default defineDemotedPath({
  name: "relaxpath-bvp",
  tier: "live-demoted",
  demotedAt: "c17b543",
  demotedOn: "2026-06-11",
  supersededBy:
    "Locomotion.settleDirectedPath (Lyapunov damped-particle settling, initial-value problem)",
  rollbackFlag: "DOPAT_CONFIG.PHYSICS.SETTLING_TRAVERSE_PRIMARY=false",
  capabilityDelta:
    "Fixed-endpoint boundary-value geodesic via path relaxation. Ill-conditioned on dense clusters (reach 0.52 / onPath 0.684 vs settling 1.00 / 0.872), so superseded for primary traversal. Retained because the GPU-offload geodesic path still uses it and it is the rollback for any settling regression.",
  revivalTrigger:
    "Only as a rollback if a settling regression is found, or to keep the GPU-offload geodesic path validated.",
  dependencySurface: [
    {
      id: "relaxpath-impl",
      description: "relaxPath + getMetricForce in Locomotion (still in tree).",
      locate: {
        file: "src/core/integral/skills/cognition/Locomotion.ts",
        pattern: "relaxPath",
      },
    },
  ],
});
