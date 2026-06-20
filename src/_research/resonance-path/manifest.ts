import { defineDemotedPath } from "../_schema";

/**
 * The resonance path - propositional inference as signed wave interference over
 * a transfer matrix, deleted at the new-Traveler cutover. The motivating
 * exhibit for this whole archive. See capability-diff.md for the full mechanism
 * comparison against the symbolic E1Formula that replaced it.
 */
export default defineDemotedPath({
  name: "resonance-path",
  tier: "quarantined",
  demotedAt: "18158be",
  demotedOn: "2026-05-22",
  supersededBy:
    "E1Formula.resolveLogicFormula (symbolic scope-matching rules) + settling-gradient perception",
  recoveryRef: "18158be^",
  capabilityDelta:
    "CORRECTED 2026-06-19: the headline contradiction claim was an OVERCLAIM. The recovered matrix readout does NOT derive `unknown` for A ∧ ¬A - reproduced numerically with the real recovered weights (α=0.85, W_DESTRUCTIVE=−1) in scripts/dev/contradiction_cancellation_probe.ts, it returns `A` (maxNetEnergy=0.1115 > 0; the single asymmetric destructive EDGE cannot cancel symmetrically). Contradiction-as-cancellation is instead delivered by the NEW WaveResolver (vector superposition on atom geometry: negation = antipodal position, a band cancels to |net|≈0), wired live as the `interference` provenance - so this is no longer a delta vs HEAD. The genuine, still-unreplaced deltas: (1) graded modus-tollens energy-minimum readout (a continuous −W_LENSING back-coupling drives ¬A to the energy minimum; VERIFIED in the same probe; E1Formula Rule MT is boolean); (2) operator self-discovery (infers OperatorClass from resonance flow, writes it back after 3 confirmations); (3) backward-wave missing-link/inquiry signal. The double-negation claim is also overclaimed (leading ¬¬ skipped by the i>0 && i<N-1 guard).",
  capabilityDiff: "./capability-diff.md",
  revivalTrigger:
    "When a richer-than-symbolic logic channel is wanted that the WaveResolver does NOT already cover: graded sink-strength confidence, operator self-discovery, or the inquiry/missing-link signal. NOTE contradiction is no longer a revival reason - the WaveResolver delivers it (and correctly, where the matrix returned `A`).",
  dependencySurface: [
    {
      id: "resolver-weights",
      description:
        "DOPAT_CONFIG.resolver.* interference weights (W_CONSTRUCTIVE / W_DESTRUCTIVE / W_LENSING / PROPAGATION_ALPHA / PROPAGATION_ITERS / AGE_ENERGY_WEIGHT / OPERATOR_DISCOVERY_*). The whole resolver block was removed with the path.",
      locate: { file: "src/config.ts", pattern: "W_DESTRUCTIVE" },
    },
    {
      id: "workspace-buffers",
      description:
        "Per-slot scratch buffers on the old TravelerWorkspace (T_buffer / W_buffer / E_total_buffer / E_curr_buffer / E_new_buffer / T_back_buffer / ...). Removed in the post-cutover refactor.",
      locate: {
        file: "src/core/integral/TravelerWorkspace.ts",
        pattern: "E_total_buffer",
      },
    },
    {
      id: "gpu-f64-ops",
      description:
        "GPU dense matrix ops for the propagation step (matMulF64 / mulScalarF64 / addF64). Present but relocated to _lib/math/TensorMath.ts.",
      locate: { file: "src/_lib/math/TensorMath.ts", pattern: "matMulF64" },
    },
    {
      id: "operator-class",
      description:
        "OperatorClass enum members (Inversion / IdentityShift / Quantifier / Conjunction / Sink / Modifier / None). Present but relocated to integral/helpers/enums.ts.",
      locate: {
        file: "src/core/integral/helpers/enums.ts",
        pattern: "Inversion",
      },
    },
    {
      id: "wave-handlearray",
      description:
        "Wave.HandleArray ambient type used by snapshot/Waves.ts (ComplexArray / FFT).",
      locate: { file: "src/_types/External.d.ts", pattern: "HandleArray" },
    },
  ],
  characterization: [
    {
      // CORRECTED 2026-06-19: this characterization was FALSE. The matrix readout
      // does NOT emit `unknown` for A ∧ ¬A - it returns `A` (maxNetEnergy=0.1115 > 0;
      // a single asymmetric destructive edge cannot cancel symmetrically). Kept as a
      // negative record: a revival of THIS path must NOT be graded against this case.
      // Contradiction-as-cancellation is delivered by the WaveResolver instead.
      id: "contradiction-unknown",
      inference:
        "contradiction A ∧ ¬A (OVERCLAIM - matrix returns `A`, not unknown)",
      input: "A and not A |-",
      expected:
        "returns `A`, NOT unknown - empirically (scripts/dev/contradiction_cancellation_probe.ts). The capability now lives in WaveResolver (vector cancellation, `interference` provenance), not this matrix path.",
      supersededBehavior:
        "WaveResolver: A and ¬A are antipodal positions, band cancels to |net|≈0 ⇒ DERIVES unknown (the capability the matrix only claimed to have). E1Formula: returns null, defers.",
    },
    {
      id: "modus-tollens-energy-min",
      inference: "modus tollens (A⇒B) ∧ ¬B ⊢ ¬A",
      input: "A implies B and not B |-",
      expected:
        "¬A as the least-energised non-negated candidate (negative back-coupling −W_LENSING on the bridge)",
      supersededBehavior:
        "E1Formula Rule MT: explicit consequent-scope match - same answer, symbolic mechanism",
    },
    {
      id: "operator-discovery",
      inference: "operator self-discovery",
      input: "a sequence with an unlabelled connective token",
      expected:
        "infers OperatorClass from resonance flow ratio and writes it back to the manifold after CONFIRM_THRESHOLD=3 confirmations",
      supersededBehavior:
        "none - E1Formula requires operator classes pre-assigned",
    },
    {
      id: "missing-link-inquiry",
      inference: "missing-link detection",
      input: "a query with a gap in the reference chain",
      expected:
        "flags the gap as a bridge candidate (backward ≫ forward energy) for InquiryQueue",
      supersededBehavior: "none",
    },
  ],
});
