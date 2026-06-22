# Research findings (non-demotion)

`REGISTRY.md` records mechanism *replacements* (a primary was superseded and
demoted). This file records measured findings that are NOT replacements but must
be on the record under the same review discipline: **"the system can't do X",
"the system used to do X and deleted it", and "the mechanism for X EXISTS and is
validated but is DORMANT because a precondition isn't met" are three different
claims, and only a written record distinguishes them.** A reviewer grading HEAD
who sees the dormant case behaving like the absent case will grade an unbuilt
precondition as a missing capability - the same contamination the registry note
warns about for the resonance path.

Each entry: what was measured, the number, and the precise reason a naive read of
HEAD would get it wrong.


## electSkill potential-field election is built + validated but DORMANT in production (2026-06-22)

`Traveler.electSkill` was rewritten from intent string-matching to **attractor
proximity**: each capability precept's mass-weighted Gaussian pull
`mass·e^{-d²/F}` at the query's manifold centroid, deciding only on a deep
(`SKILL_FIELD_MIN_DEPTH`) and unambiguous (`SKILL_FIELD_DOMINANCE`) well, else
the intent classifier's prior holds. Guarded by `tests/skill_election.test.ts`;
the geometric override is proven to fire on a separated, properly-tagged
capability.

**The finding: in a live Runtime the election NEVER exercises its geometry - it
always defers to the intent prior, reproducing the legacy string routing
exactly.** Two measured causes, both preconditions, not capability gaps:

1. **`seedCapabilities` never takes effect.** `Runtime.seedCapabilities` intends
   the four SKILL:* precepts at distinct, separated coordinates
   (LANGUAGE 25 / ASSERTION 15 / CODE 60 / ARITHMETIC 5 on posX) tagged
   `OperatorClass.Capability` with mass `c²·10`. None of that is observed at
   HEAD. Measured (Runtime.boot, semantic atomizer): the precepts sit at
   posX ≈ 678–688 (CODE and ARITHMETIC co-located to within posY 0.1),
   `operatorClass` 0/1 (NOT 12 = Capability), mass `c² = 277.78` (NOT `c²·10`).
   So they were allocated as the literal "SKILL:*" tokens (grounded near each
   other in GloVe space) BEFORE `seedCapabilities` ran, and its
   `if (sys.isAllocated(id)) return;` guard then skipped every seed. The seed
   coordinates/tags/mass are dead code in the live path.

2. **The election reads only genuine `Capability` precepts as field sources**
   (`operatorClass[sid] === OperatorClass.Capability`). Since (1) leaves none
   tagged, no field source qualifies, `winId` stays 0, and the prior decides.
   This guard is also load-bearing for correctness, not just dormancy: in a bare
   test env (`createTestTraveler`, no `seedCapabilities`) the SKILL:* scope ids
   1–4 get REUSED for the first ingested query tokens ("the sky is blue"), so
   reading those ids' positions as attractor coordinates routed an assertion
   query into the CODE skill (`[processCode] Parse error`). The Capability guard
   prevents reading query-token positions as capability wells.

**Why a naive HEAD read gets it wrong:** routing is string-equivalent to the old
stub, so an observer concludes "electSkill still can't route geometrically / the
potential-field election was never built." It WAS built and unit-validated; it is
gated off by an unmet precondition (separated, Capability-tagged attractors).

**Revival trigger / what would activate it:** make `seedCapabilities` actually
place + tag the SKILL:* precepts (fix the `isAllocated` skip so the seed wins
over the token grounding, or seed before the tokens are ingested), with the four
at genuinely separated coordinates. Then re-run the suite: geometric routing must
still reproduce the intent routing on the labelled corpus (the validation
criterion), now via real wells rather than the prior. Until then the prior is
load-bearing and the dominance/min-depth gates keep co-located near-ties
deferring to it. (`src/core/integral/Runtime.ts` seedCapabilities;
`Traveler.electSkill`; ROADMAP intermediate step #6.)


## Backward-W propagation: the directional asymmetry already lived in the force (2026-06-22)

`DirectionalPropagation.ts` makes reasoning-vs-rationalization a measurable
amplitude (NOTES.md "The W Dimension"): support decays
`e^{-W_PROPAGATION_DECAY·|Δw|}` both directions plus an extra
`e^{-W_BACKWARD_PENALTY·|Δw|}` only when the wave reaches BACKWARD (newer
conclusion → older premises = rationalization).

**The finding worth recording: the direction-dependent attenuation was NOT new -
the locomotion force already encoded it.** `forceFromCandidates`'
`infl *= exp(-PHI_TEMPORAL_DECAY · max(0, dw))` (dw = pw_probe − pw_atom)
suppresses influence ONLY when the probe reaches toward an OLDER atom (dw > 0);
reaching a newer atom (dw < 0 ⇒ max(0,·)=0) is loss-free. That is exactly
"backward = attenuated, forward = free." The new module lifts this latent
asymmetry out of the metric force and into an explicit support-amplitude the
thinker can read (`Traveler.inferenceAmplitude` / `inferenceDirection`), so the
distinction becomes an output property rather than a dormant side effect of the
temporal-decay term.

**Falsifiable exit, measured** (`scripts/dev/backward_w_propagation_diag.ts`,
500 random inferences): 0 violations (backward < forward on every non-degenerate
case; W-coincident premises give ratio 1, no direction to distinguish), mean
backward/forward ratio 0.21. Guarded by `tests/directional_propagation.test.ts`.


## Scene-graph fidelity: the two "non-PASS" corpora are statistical ties, not failures (2026-06-22)

`SceneGraph.buildGraphFromScene` + `SceneAtomizer` ground a scene through the
same IR / placement / fidelity machinery as code and logic.
`scripts/dev/scene_corpus_sweep.ts`: 3/5 PASS, mean static pearson 0.99, mean
dynamic onPath 1.00 - matching code (0.94/0.95) and logic (0.98/0.95).

**The finding: the 2 non-PASS corpora ("nested rooms" - a pure containment tree;
"object stack" - a pure on-chain) are structurally PERFECT (pearson 1.00,
onPath 1.00) and miss the PASS gate ONLY because a pure tree/chain lets even the
shuffled-coordinate null traverse on-path (null onPath 0.50), so the
`onPath > 2·null` clause can't separate them.** This is the identical artifact
the logic sweep's "implication chain" hit (a pure line) - a property of degenerate
topology, not of scene grounding. Read as "3/5 scenes ground faithfully" the
number is misleading; read as "5/5 ground at pearson ≥ 0.98 / onPath ≥ 1.00, 2 of
which a pure-line null also happens to traverse" it is correct. Guarded
(non-degenerate case) by `tests/scene_grounding.test.ts`.


## Coherence gate is back to 100% - the pinned disj2 over-abstain was already resolved at HEAD (2026-06-22)

Unrelated to the increments above (verified by stashing them): at HEAD the
coherence gate is **100% balanced accuracy**, not the 96.4% recorded in the
2026-06-21 review note. Commit `2e20a1a` ("fix: stale coherence benchmark
functionality, didn't account for the new antonymic placements") resolved disj2's
singular placement, so disj2 now emits its correct answer "inside" and no longer
over-abstains. `tests/coherence_calibration.test.ts` was updated per its own
embedded instruction (`KNOWN_OVER_ABSTAINS = []`, floor raised to 1.0). The
"gate 96.4% / disj2 pinned" record is superseded. Worth noting because the same
benchmark-not-run-by-CI blind spot caused the earlier silent 100%→66.7%
regression - the calibration guard now runs in the suite, so a real drop will
fail CI rather than rot.
