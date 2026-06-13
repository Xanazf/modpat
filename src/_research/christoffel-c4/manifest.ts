import { defineDemotedPath } from "../_schema";

/**
 * C4 learned Christoffel correction (deltaGamma). Retired 2026-06-12 after being
 * measured to not help and shown structurally incompatible with the settling
 * dynamics that replaced relaxPath. Still in the tree behind the settling flag;
 * not expected back. The C3 Ricci-flow treatment applied to C4.
 */
export default defineDemotedPath({
  name: "christoffel-c4",
  tier: "retired",
  demotedAt: "c4_settling_retarget_diag (see ROADMAP Phase 4 open items)",
  demotedOn: "2026-06-12",
  supersededBy:
    "ground-truth corrections written into precept coordinates (local, addressable) rather than a learned connection blob",
  rollbackFlag: "DOPAT_CONFIG.PHYSICS.SETTLING_TRAVERSE_PRIMARY=false (rides with relaxPath)",
  retirementReason:
    "Measured: random deltaGamma degrades onPath 0.952 to 0.926; fidelity-reward hill-climb saturates at +0.016 (noise on a 32-pair corpus). Structural: the deltaGamma force is non-dissipative and voids the settle's Lyapunov dE/dt <= 0 guarantee; its reward loop lived in the retired relaxPath review; a 64-float blob is un-addressable, the implicit-weights regime the thesis rejects.",
  capabilityDelta:
    "Learned per-manifold Christoffel correction (geodesic deviation trained from traversal success/trap). Retired rather than demoted: measured not to help and incompatible with the Lyapunov settling dynamics, so there is no condition under the current model where it returns.",
  revivalTrigger:
    "Reopens only if the geodesic problem is re-posed so a connection-learning term is both well-conditioned and addressable. Dead end under the current g = e^{2phi} delta model.",
  dependencySurface: [
    {
      id: "christoffel-force",
      description: "deltaGamma + _christoffelForce training in Traveler (still in tree behind the flag).",
      locate: { file: "src/core/integral/Traveler.ts", pattern: "deltaGamma" },
    },
  ],
});
