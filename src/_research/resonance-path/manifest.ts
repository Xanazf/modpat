import { defineDemotedPath } from "../_schema";

/**
 * The resonance path — propositional inference as signed wave interference over
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
    "Derives `unknown` for a contradiction (A ∧ ¬A) from destructive interference — opposite-sign couplings cancel to net energy ≤ 0. E1Formula has NO contradiction rule: it returns null and defers to settling (abstains, does not derive). Also unique to this path: operator self-discovery (infers OperatorClass from resonance flow and writes it back to the manifold after 3 confirmations) and a backward-wave missing-link/inquiry signal — neither has any replacement in the current code.",
  capabilityDiff: "./capability-diff.md",
  revivalTrigger:
    "When a richer-than-symbolic logic channel is wanted: contradiction-as-cancellation, graded sink-strength confidence, operator self-discovery, or the inquiry/missing-link signal. Revive contradiction first (smallest slice: matrix build + propagation + the maxNetEnergy ≤ 0 readout).",
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
      id: "contradiction-unknown",
      inference: "contradiction A ∧ ¬A",
      input: "A and not A |-",
      expected:
        "emits `unknown` — destructive cancellation drives net sink energy ≤ 0 (block.ts:483)",
      supersededBehavior:
        "E1Formula: conditionals.length === 0 ⇒ returns null at :174, defers to settling (abstains, does not derive)",
    },
    {
      id: "modus-tollens-energy-min",
      inference: "modus tollens (A⇒B) ∧ ¬B ⊢ ¬A",
      input: "A implies B and not B |-",
      expected:
        "¬A as the least-energised non-negated candidate (negative back-coupling −W_LENSING on the bridge)",
      supersededBehavior:
        "E1Formula Rule MT: explicit consequent-scope match — same answer, symbolic mechanism",
    },
    {
      id: "operator-discovery",
      inference: "operator self-discovery",
      input: "a sequence with an unlabelled connective token",
      expected:
        "infers OperatorClass from resonance flow ratio and writes it back to the manifold after CONFIRM_THRESHOLD=3 confirmations",
      supersededBehavior:
        "none — E1Formula requires operator classes pre-assigned",
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
