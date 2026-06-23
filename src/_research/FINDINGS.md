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


## Repair operator: measured zero payoff on every gate-abstain case (2026-06-12)

`scripts/dev/repair_operator_diag.ts` measured three candidate repairs
(probe-mode re-traverse, reinforce-input-masses + retry, plain re-perceive) on
every gate-abstain case of the calibration corpus.

**The finding: payoff = 0 for all three.** Every abstain is a true negative
(disj1 / broken1 / broken2 are genuinely unanswerable), and the gate correctly
re-catches the same candidate after each repair, with zero wrong-flips.

**Why a naive HEAD read gets it wrong:** the Phase 2 roadmap describes
"repair-then-abstain" as a key gate behaviour. A reader concludes the repair step
is unbuilt. It WAS measured — three candidates, all zero payoff — and the
repair stays unwired per its own deferral condition ("wire the one that pays" —
none pays). The abstain cases are genuine negatives, not repair opportunities.
Graded abstention (definitive → hedged → silent) is the surface for the
failed-repair case.


## Conformal metric / Ricci flow: dead end for faithfulness on grounded manifolds (2026-06-12)

`scripts/dev/faithfulness_dynamics_diag.ts` drove the geometry self-correction
against the traversal-fidelity objective. Three falsifiable findings:

1. **φ fully saturates** on a grounded manifold — meanφ = 50.00 = `PHI_MAX`
   (≈21 neighbours × infl≥5), so the conformal factor `e^{−2φ} ≈ 3.7e-44 ≈ 0`.
2. **C3 Ricci flow is therefore inert** — `R = −6 e^{−2φ}(…) ≈ 0`, mean|R| = 0;
   traversal fidelity is flat across 200 Ricci steps. The driving signal has
   vanished, so it cannot self-correct toward (or away from) faithfulness.
3. **The conformal metric force *hurts* faithfulness in dense regions**: disabling
   it raised onPath 0.714→0.745, monotonic 0.844→0.908, reach 0.60→0.65 — because
   `e^{−2φ}` multiplies the attractor force by ~0 in dense zones, so geodesics
   bypass the central hubs faithful inference should route through.

**The deeper result** (`scripts/dev/newtonian_relax_proto.ts`): stabilization and
muting are the **same mechanism**. With `CONFORMAL_ENABLED=false` the relaxation
action diverges (8.1→22 on a dense cluster). Every attempt to keep the force
un-muted while restoring monotonic descent failed: per-point adaptive step
(monotonic only when inert), `CONFORMAL_PHI_SCALE` sweep (no sweet spot),
backtracking line-search (backtracks to ~0 step — the conformal-OFF action is
ill-conditioned). The fidelity-0.745 number came from a non-converged,
overshooting relaxation, not a principled geodesic.

**Real conclusion: the metric/force formulation (`g=e^{2φ}δ`) does not pose a
well-conditioned faithful-geodesic problem.** The action landscape is flat
(conformal on) or ill-conditioned (off). This was resolved by changing the
dynamics entirely — from the boundary-value relaxation to a Lyapunov
damped-particle settling (see REGISTRY.md, "Settling replaces relaxPath"), not by
re-deriving the conformal metric. C3 Ricci flow and C4 Christoffel learning are
both dead ends for faithfulness under the conformal model.

**Why a naive HEAD read gets it wrong:** the conformal factor, Ricci flow, and
Christoffel code are all still in the tree. A reader assumes they are functional
mechanisms awaiting integration. They are measured dead ends — the signal they
rely on (scalar curvature via φ) vanishes on any manifold dense enough to be
useful. The settling arc bypassed the problem entirely.


## d3-force-3d / d3-hexadectree: evaluated and rejected (2026-06-12)

`scripts/dev/hexadectree_radius_proto.ts` and `settling_verlet_proto.ts`
evaluated both libraries against `GridIndex4D` for the traversal hot path.

**The finding: all negative.**

- **d3-hexadectree** is the proper 4D tree but loses **~20×** to `GridIndex4D`
  on clustered radius queries (it allocates a result array + per-node accessor
  closures + a wrapper per visited node, vs the grid's flat sorted-bucket scan).
  Results are identical.
- **Barnes-Hut multipole approximation is inapplicable**: the metric force is a
  Gaussian kernel with a hard radius cutoff, so far bodies contribute exactly 0
  and near bodies can't be lumped into a distant multipole — Barnes-Hut only pays
  for long-range 1/r forces.
- **d3-force-3d** is 3D-capped (drops the W axis); its alpha-cooling sacrifices
  faithfulness.

**Why a naive HEAD read gets it wrong:** the Phase 4 roadmap originally listed
"Barnes-Hut / grid / framework indices" as the DOD navigation layer. A reader
expects a tree-based acceleration structure. The grid already dominates; neither
library improves the hot path. The "Barnes-Hut" item is closed as
not-applicable.


## Grid-backed candidate set for _extractIds: no speedup (2026-06-12)

Tried replacing `_extractIds`'s W-sorted scan with a grid-backed candidate set.

**The finding: no speedup** (heavy load 1410→1420 ms) and it is an approximation
(shuffled traversal-onPath drifted 0.09→0.11). The extraction metric is
W-*dominated* (`tot = distSq + dw²·1e6`), so the right index is W-first; the
grid is XYZ-first with coarse W cells (size 40 ≫ the ~0.1 W scale). The
W-sorted scan already prunes hard (`dw²·1e6 ≥ minDiff` cuts it short once a
near-W atom is found), and the grid query's cell-walk + Map lookups cost what
they save. Also, the synthetic benchmark uses artificially tight W (clusters
overlap in W), inflating the W-band; real grounded W is the spread-out number
line where the scan discriminates well. The W-sorted scan stays.


## Pole-ingestion measured and REJECTED — gated off (2026-06-12)

`POLE_INGESTION_ENABLED` is **kept false**. Reproducing the real pole path on
referent-seeded atoms (record the grounded position as the drift target, jitter
to the pole, then run `Perception.settleAtoms`) **destroys** the validated
placement: pearson collapses 0.225 → **−0.012**, mean |Δposx| 0.000 → 0.694 —
the `POLE_JITTER_XYZ=0.05` displacement throws away the hundreds-of-units
grounded X-layout and 20-tick settling cannot reconstruct it.

**Why a naive HEAD read gets it wrong:** the ROADMAP's Phase 5 says
"pole-ingestion + settling becomes the standard path, seeded by structure." A
reader expects the pole flag to be on. Direct referent-seeding IS "seeded by
structure" and **subsumes** the pole-jitter mechanism — it places exactly what
pole-ingestion would approximately re-settle. The roadmap goal is met by the
simpler channel; the pole flag stays off as a measured dead end.
