# Resonance path vs. `E1Formula`: a mechanism diff

> How propositional inference was done by **wave interference** before the
> new-Traveler cutover (`18158be`), versus how it is done by **symbolic
> scope-matching rules** in the current `E1Formula`.

## Provenance

| | Resonance path (old) | `E1Formula` (current) |
|---|---|---|
| Lives in | `Traveler._perceiveWithSlot` | `src/core/integral/formula/E1Formula.ts` |
| Last present at | `18158be^` (parent of the cutover) | HEAD |
| Recovered to | `./snapshot/perceiveCapturing_block.ts` (+ `resonance_operator_helpers.ts`, `Waves.ts`); reproduce via `./recover.sh` | — |
| Removed by | `18158be` "finalize new Traveler behavior, old behavior to be deleted" | — |
| Nature | impure, stateful, GPU-capable, physics | pure function, no instance state, CPU-only |

The cutover deleted the resonance path; the R4/R5 conjunction cases regressed to
`unknown` for months as a result (see the `conjunction-regression` record). The
symbolic `E1Formula` is the replacement that was grown back rule-by-rule, with
conjunction elimination added 2026-06-03 as an explicit "last resort" (Rule 4)
to restore what the resonance path had done natively.

## One sentence each

- **Resonance path** — lay the token sequence out as a signed **transfer matrix**
  `T` (operators write couplings: `+` constructive, `−` destructive, mass-scaled
  lensing for implication), propagate energy through its powers
  `I + αT + α²T² + …` (a damped Neumann series = "resonance"), sweep a backward
  wave from the sink, and **read the answer off the net energy landscape**. A
  contradiction's opposite-sign couplings cancel → flat field → no peak →
  `unknown` *is derived*, not declared.
- **`E1Formula`** — split the sequence into AND-clauses at conjunction/sink
  tokens, parse each into antecedent/consequent scope sets, and fire a fixed
  ladder of **symbolic rules** (modus ponens, modus tollens, universal
  instantiation, transitivity, conjunction elimination) by **set membership** on
  scope ids. Returns the concluded id sequence, or `null` to defer to settling.

---

## Architecture, side by side

### Resonance path — the pipeline (`_perceiveWithSlot`)

1. **Energy init** (`block.ts:142`). A vibration vector seeded at token 0, boosted
   by context scopes and **freshness** (age-decayed `posW`) — recency is energy.
2. **Transfer-matrix construction** (`block.ts:175`). For each token, write
   couplings keyed by `OperatorClass`:
   - same-scope, non-operator → `W_CONSTRUCTIVE` (in-phase reinforcement, `:194`)
   - `IdentityShift` / `Quantifier` → `W_LENSING × mass/c²` on the `A⇒B` bridge —
     **mass is amplitude** (`:206–208`)
   - `Inversion` → `W_DESTRUCTIVE` (`:210`) — **negation is negative charge**
   - **Modus-tollens wiring**: a trailing `not B` writes a *negative*
     back-coupling `−W_LENSING` onto any `A⇒B` bridge (`:214–237`)
   - row-normalize, then a `constructiveFloor` keeps same-scope tokens coupled
     (`:239–263`)
3. **Forward resonance propagation** (`block.ts:265`). `current = current · T`,
   damped by `PROPAGATION_ALPHA`, accumulated over `PROPAGATION_ITERS` steps
   (GPU `matMulF64` for `N>16`, else triple loop). This is the interference:
   multi-hop paths superpose with sign.
4. **Operator discovery** (`resonance_operator_helpers.ts:1`). Tokens whose
   accumulated in/out flow ratio crosses thresholds are *inferred* to be
   operators (`IdentityShift`/`Conjunction`); after `CONFIRM_THRESHOLD=3`
   confirmations the class is **written back into the manifold** (`:71`). The
   resonance path can *learn new operators from usage*. `E1Formula` has no
   analogue — it assumes operator classes are pre-assigned.
5. **Backward energy from the sink** (`block.ts:326`). A second wave `T_back`
   propagated along `Tᵀ` from the sink node — the "backward resonance wave".
6. **Bridge detection** (`block.ts:356`). Non-operator tokens scored by
   `forward × backward`; high backward but low forward = a **missing link**
   (a gap in the terrain, an inquiry candidate).
7. **Sink selection** (`block.ts:391`). Each candidate's
   `strength = incoming / (1 + outbound)`; max net energy wins. `≤ 0` ⇒ fall to
   code-synth or emit **`unknown`** (`:483–489`).
8. **Modus-tollens readout** (`block.ts:450`). With a direct negation present,
   return the **least-energised non-negated** candidate prefixed by the inversion
   token — `¬A` falls out as the energy minimum.

### `E1Formula` — the rule ladder (`resolveLogicFormula`)

1. **Clause split** at `Conjunction`/`Sink` (`E1Formula.ts:40`).
2. **Parse** each clause → `{antecedentScopes, antecedentIds, consequentIds,
   opId, universal, modifierId, isQuantifier, negationId}` (`:57–146`).
   Inversions are stripped in consequent parsing, so `not not B` collapses to `B`.
3. **Rule ladder**, first match wins:
   - Rule 0 Existential `∀x.∃y ⊢ y` (`:148`)
   - Rule S single-clause conditional / double-neg (`:154`)
   - **Rule 1 Modus ponens** `(A⇒B) ∧ A ⊢ B` by scope-set membership (`:176`)
   - **Rule MT Modus tollens** `(A⇒B) ∧ ¬B ⊢ ¬A` (`:194`)
   - **Rule 2 Universal instantiation** `(∀A.B) ∧ (x is A) ⊢ x is B` (`:211`)
   - **Rule 3 Transitivity** with explicit chain-following up to 20 hops (`:236`)
   - **Rule 4 Conjunction elimination** `A ∧ B ⊢ A`, last resort, ≥2 clauses
     (`:300`)
   - else `null` → caller defers to the settling probe.

---

## Per-rule comparison

| Inference | Resonance path | `E1Formula` |
|---|---|---|
| **Modus ponens** | forward propagation; sink = max `incoming/(1+outbound)` energy | Rule 1: scope-set membership of antecedent in facts |
| **Modus tollens** | `−W_LENSING` back-coupling + "least-energised non-negated" readout | Rule MT: explicit `¬B` consequent match → emit `¬A` |
| **Universal instantiation** | mass-scaled `W_LENSING` bridges + propagation | Rule 2: explicit antecedent-scope match |
| **Transitivity** | *emergent* from `Tᵏ` (matrix powers chain hops), damped, depth-capped by `PROPAGATION_ITERS` | Rule 3: *explicit* chain-walk, up to 20 hops, undamped |
| **Double negation** | two `W_DESTRUCTIVE` couplings compose → constructive (sign flips twice) | parser strips inversions in the consequent |
| **Conjunction** | emergent: same-scope constructive coupling + sink selection (the path that originally passed R4/R5) | Rule 4: explicit last-resort, returns first conjunct |
| **Operator discovery** | **yes** — infers + writes back operator classes from flow ratios | **none** — classes must be pre-assigned |
| **Contradiction `A ∧ ¬A`** | destructive cancellation → `maxNetEnergy ≤ 0` → **emits `unknown`** | no contradiction rule; `conditionals.length === 0` ⇒ returns `null`, **defers to settling** |
| **Missing-link / inquiry** | **yes** — bridge candidates (`bwd ≫ fwd`) flag terrain gaps | none |

### The load-bearing divergence: contradiction

This is the case that motivated recovering the path. For
`A && not A |-` (`[A, &&, not, A, |-]`):

- **Resonance path**: the `A` and `not A` couplings carry opposite sign; after
  propagation the net energy at the conclusion cancels to `≤ 0`, so the readout
  takes the `maxNetEnergy <= 0` branch (`block.ts:483`) and **emits a literal
  `unknown` precept**. The flat line *is* the derivation — "no coherent
  conclusion exists" is computed from the physics.
- **`E1Formula`**: the two clauses are bare facts with no `IdentityShift`, so
  `conditionals.length === 0` and the function **returns `null` at `:174`**
  before any contradiction logic. It does not *conclude* unknown; it *declines
  to fire* and hands off to the settling probe. The end-user effect (no wrong
  assertion) can coincide, but the **provenance differs**: derived-`unknown`
  (physics) vs. rule-miss-`null` (symbolic abstention). The thesis ("computation
  falls out of geometry") is satisfied only by the former.

---

## What each does better

### Resonance path — strengths
- **Physics, not lookup.** Contradiction, MT, double-negation are sign
  arithmetic on amplitudes — the unified-domain thesis made operational.
- **Emergent transitivity & conjunction** from `Tᵏ` — no per-rule code.
- **Operator discovery / self-modification** — learns operator classes from
  resonance and writes them back to the manifold.
- **Inquiry signal** — backward wave exposes missing links (terrain gaps) for
  free; directly feeds `InquiryQueue`.
- **Graded output** — `sinkStrength` is a continuous confidence, not a boolean.

### Resonance path — costs
- **Impure & stateful** — reads/writes `system`, `operatorEvidence`, workspace
  slot buffers; not a pure function.
- **GPU-coupled** — `matMulF64`/`mulScalarF64`/`addF64` for `N>16`.
- **`O(N³ × PROPAGATION_ITERS)`** dense matmul per query.
- **Config-heavy** — a whole `DOPAT_CONFIG.resolver.*` block of magic weights
  (`W_CONSTRUCTIVE`, `W_DESTRUCTIVE`, `W_LENSING`, `PROPAGATION_ALPHA`,
  `PROPAGATION_ITERS`, `AGE_ENERGY_WEIGHT`, `OPERATOR_DISCOVERY_*`).
- **Never null-tested** — its correctness was validated ad hoc, which is exactly
  why R4/R5 could silently regress at the cutover.

### `E1Formula` — strengths
- **Pure & deterministic** — `(ids, view) → ids | null`, no GPU, no state, no
  config; trivially testable and reproducible.
- **Cheap** — `O(clauses × scopes)` set ops.
- **Explicit transitivity** — undamped, depth-20 chain-follow that can reach
  further than a damped depth-capped `Tᵏ`.
- **Legible** — each rule is a named, auditable branch.

### `E1Formula` — costs
- **No physics** — pure symbol shuffling; nothing "falls out of geometry".
- **No contradiction derivation** — abstains rather than computing `unknown`.
- **No operator discovery** — operator classes must already exist.
- **No inquiry/missing-link signal.**
- **Brittle to surface form** — depends on exact clause-split tokens; new
  connectives need new branches (the disjunction/negation work bolted on later).

---

## Reviving the resonance path — dependency surface

The recovered code is reference-only (plain `.ts` in `./snapshot/`, excluded
from tsc, not wired). To reintegrate, confirm these still exist post-cutover and
post-refactor (or run `tsx scripts/dev/attic_status.ts`):

- **`DOPAT_CONFIG.resolver.*`** — `W_CONSTRUCTIVE`, `W_DESTRUCTIVE`, `W_LENSING`,
  `PROPAGATION_ALPHA`, `PROPAGATION_ITERS`, `AGE_ENERGY_WEIGHT`,
  `OPERATOR_DISCOVERY_MIN_FLOW`, `_OUTBOUND_THRESHOLD`,
  `_CONJUNCTION_THRESHOLD`, `_CONFIDENCE_THRESHOLD`. The whole `resolver` block
  likely died with the path.
- **Workspace slot buffers** — `T_buffer`, `W_buffer`, `E_total_buffer`,
  `E_curr_buffer`, `E_new_buffer`, `T_back_buffer`, `T_back_next_buffer`,
  `backwardEnergyBuffer`, `T_next_buffer`, `directScopesBuffer`,
  `resultIdsBuffer` on the old `TravelerWorkspace`.
- **GPU** — `this.gpu.{matMulF64, mulScalarF64, addF64}`.
- **`OperatorClass.{Inversion, IdentityShift, Quantifier, Conjunction, Sink,
  Modifier, None}`** — still in `System.ts`, probably intact.
- **`Wave.HandleArray`** — ambient type `Waves.ts` needs; check it survived the
  `_types` reshuffle.
- **Types** — `PerceptionCapture`, `PerceptionDiagnostics`, `BridgeCandidate`,
  `DiscoveredOperator`.

## Recommended direction (not a decision — for the author)

The two are not either/or. The cleanest synthesis keeps `E1Formula`'s purity as
the **fast symbolic path** and revives the resonance mechanism as the
**physical fallback / oracle** for the cases `E1Formula` can't express:

1. **Resurrect contradiction-as-cancellation first** — it is the single
   capability `E1Formula` structurally lacks (it returns `null`, never derives
   `unknown`), it is the cleanest demonstration of the thesis, and it is a small
   slice of the pipeline (matrix build + propagation + the `maxNetEnergy ≤ 0`
   readout).
2. **Put it under the null-baseline regime** the grounding/traversal work
   already uses — a guarded test where `A ∧ ¬A` must derive `unknown` via
   cancellation, failing loudly if a future refactor deletes the path again.
   This is the discipline the resonance path never had.
3. Treat operator-discovery and the inquiry/missing-link signal as separable,
   higher-cost increments — valuable, but not on the critical path to proving
   the interference claim.

The point the resonance path proves and `E1Formula` cannot: propositional
inference *was* emergent wave physics here, then got replaced by symbol-shuffling
in a cutover. Recovering even the contradiction case turns "logic doesn't fall
out of the geometry yet" back into "it did, and here's the guarded test."
