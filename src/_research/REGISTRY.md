# Demoted path registry

This file is a timeline of mechanism replacements. Each entry records what
replaced what, when, why, and which files were involved. When a replacement
removed code from the tree, the entry lists how to revive it from git.

Machine-readable detail (dependency probes, capability cases) lives in each
path's manifest.ts. Revival readiness is reported by
scripts/dev/attic_status.ts.

Tiers:
- live-demoted: code still compiles, wired behind a rollback flag.
- quarantined: code removed from the tree, preserved as a snapshot plus a git
  recovery pointer.
- retired: set aside for a measured reason, not expected to return.


## E1Formula replaces the resonance path at 2026-05-22

Tier: quarantined
Commit: 18158be (finalize new Traveler behavior, old behavior to be deleted)

What changed:
The transfer-matrix resonance pipeline that resolved propositional logic by
signed wave interference was deleted. Symbolic scope-matching rules in
E1Formula took over.

Reasons:
- Speed. The resonance path ran a dense matrix-power propagation per query.
  E1Formula is set membership over clause scopes.
- Purity. E1Formula is a pure function from (ids, view) to ids or null: no
  instance state, no GPU, no config weights. The resonance path read and wrote
  system state, mutated operator evidence, used GPU matmul, and depended on a
  block of hand-tuned resolver weights.
- Testability. E1Formula is trivially unit-testable. The resonance path had no
  guard test, which is why this deletion went unnoticed: the R4 and R5
  conjunction cases regressed to unknown for months.

Capability lost (the reason to keep it):
- Contradiction. "A and not A" cancels to net energy at or below zero and emits
  unknown as a derived result. E1Formula has no contradiction rule and returns
  null instead, deferring to settling.
- Operator discovery. Infers an operator class from resonance flow and writes
  it back to the manifold after three confirmations. No replacement.
- Missing-link signal. The backward wave flags reference-chain gaps as bridge
  candidates for the inquiry queue. No replacement.

Files removed (at 18158be):
- src/core/integral/Traveler.ts: the _perceiveWithSlot resonance pipeline, plus
  the discoverOperatorsByResonance and findDominantOperator helpers.
- src/core/structural/properties/Waves.ts: complex-number and FFT primitives.

Files added:
- src/core/integral/formula/E1Formula.ts

Revive from git:
- Reference snapshot: src/_research/resonance-path/snapshot/
- Reproduce snapshot: src/_research/resonance-path/recover.sh (reads 18158be^)
- Mechanism comparison: src/_research/resonance-path/capability-diff.md
- Dependency status: tsx scripts/dev/attic_status.ts
  Missing today: the resolver weight block (src/config.ts) and the old
  TravelerWorkspace slot buffers. Present but relocated by later refactors:
  matMulF64 (src/_lib/math/TensorMath.ts), OperatorClass
  (src/core/integral/helpers/enums.ts), Wave.HandleArray
  (src/_types/External.d.ts).


## Settling replaces relaxPath at 2026-06-11

Tier: live-demoted
Commit: c17b543 (settling via system energy)
Rollback flag: DOPAT_CONFIG.PHYSICS.SETTLING_TRAVERSE_PRIMARY (true keeps
settling primary, false restores relaxPath)

What changed:
travel() now defaults to settleTravel, a Lyapunov damped-particle settling
(initial-value problem). The old relaxPath was a fixed-endpoint boundary-value
path relaxation.

Reasons:
- The boundary-value relaxation is ill-conditioned on dense clusters. Measured
  on the grounded corpus: relaxPath reach 0.52 and onPath 0.684, against
  settling reach 1.00 and onPath 0.872.
- Settling is monotone by construction (energy descent), so steep wells no
  longer break it.

Status:
relaxPath is not removed. It stays wired behind the flag for rollback and is
still exercised by the GPU-offload geodesic test, which pins the flag off.
Nothing to revive from git.

Files involved:
- src/core/integral/skills/cognition/Locomotion.ts: relaxPath, settleDirectedPath
- src/core/integral/Traveler.ts: travel and settleTravel dispatch


## Coordinate corrections replace C4 Christoffel learning at 2026-06-12

Tier: retired
Rollback flag: DOPAT_CONFIG.PHYSICS.SETTLING_TRAVERSE_PRIMARY=false (rides with
relaxPath)

What changed:
The learned per-manifold Christoffel correction (deltaGamma, trained from
traversal success) was retired. Ground-truth corrections now flow into precept
coordinates instead.

Reasons:
- Measured no benefit. Random deltaGamma degrades onPath 0.952 to 0.926, and
  the fidelity-reward hill-climb saturates at plus 0.016, which is noise on a
  32-pair corpus.
- The deltaGamma force is non-dissipative and breaks the settling energy
  descent guarantee.
- A 64-float correction blob is not addressable. Coordinate corrections are
  local and inspectable, which the thesis requires.

Status:
Code stays behind SETTLING_TRAVERSE_PRIMARY=false with relaxPath. Retired, not
quarantined: still in the tree, not expected back. Nothing to revive from git.

Files involved:
- src/core/integral/Traveler.ts: deltaGamma, _christoffelForce, _updateChristoffels
