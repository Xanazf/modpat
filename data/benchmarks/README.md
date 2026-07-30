# External benchmark samples

Vendored, deterministically-sampled subsets of two AI2 deduction datasets, used
by `tsx tests/benchmarks/external_benchmarks.ts --datasets` to produce the
**honest external baseline** (PARITY.md §2: real dataset files through the
pipeline, as opposed to the repo-authored inline families).

| file | source dataset | license |
| ---- | -------------- | ------- |
| `ruletaker_sample.jsonl` | RuleTaker (rule-reasoning-dataset-V2020.2.5), Clark, Tafjord & Richardson, "Transformers as Soft Reasoners over Language" (IJCAI 2020) | CC BY 4.0 |
| `proofwriter_sample.jsonl` | ProofWriter (proofwriter-dataset-V2020.12.3), Tafjord, Dalvi & Clark, "ProofWriter: Generating Implications, Proofs, and Abductive Statements over Natural Language" (Findings of ACL 2021) | CC BY 4.0 |

Both datasets are © Allen Institute for AI, distributed under CC BY 4.0.
These files are small stratified samples redistributed with attribution.

## Unified schema (one JSON object per line)

```json
{ "id": "...", "theory": "sentence. sentence. ...", "question": "...",
  "answer": "true" | "false" | "unknown", "depth": 0 }
```

- `theory` — the natural-language fact/rule context, sentences separated by periods.
- `answer` — gold label. `unknown` occurs only in the ProofWriter open-world
  (OWA) split and is the abstention gold: the engine is *correct* to stay silent.
- `depth` — official QDep (proof depth) of the question.

## Regeneration

The samples are produced deterministically (fixed seed, stratified by depth)
by `scripts/dev/fetch_external_datasets.ts`, which downloads the official AI2
zips and emits these JSONL files. Run on a networked machine:

```bash
tsx scripts/dev/fetch_external_datasets.ts            # downloads + samples
tsx scripts/dev/fetch_external_datasets.ts --cache d  # reuse pre-downloaded zips in d/
```

Re-running with the same seed reproduces byte-identical samples, so the
committed files are auditable against the official distribution.

## Measured baseline history

The current pins live in `tests/benchmarks/metric_ab.baseline.json` under
`externalReal` (overall = all 160 items; `fast` = ingestSequence+perceive,
`honest` = full `traveler.process()` per sentence).

| date | change | honest balAcc | honest abstain | honest confFalse | fast balAcc | fast confFalse |
| ---- | ------ | ------------- | -------------- | ---------------- | ----------- | -------------- |
| 2026-07-19 | pre-change (TEXT_GRAPH_INGESTION_ENABLED=false) | 33.8% | 90.6% | 7 | 32.9% | 41 |
| 2026-07-19 | text-graph ingestion ON (grammar-grounded, PARITY §3.1 route a) | 36.2% | 93.8% | 4 | 32.9% | 41 |
| 2026-07-21 | GraphQuery readout ON (PARITY §3.1 read side: directed asserted-only ledger) | 44.3% | 83.1% | 4 | 32.9% | 41 |
| 2026-07-23 | rule discharge ON (PARITY §3.2: attribute-rule extraction + query-time OWA fixpoint closure) | 68.1% | 51.2% | 5 | 32.9% | 41 |
| 2026-07-23 | + perception-gate scoping fix + relational discharge | **83.8%** | 33.8% | **0** | 32.9% | 41 |

The 2026-07-21 pin is the fourth iteration of the read side, and the interim
numbers are the covenant at work. The naive undirected ledger measured 54.8%
balAcc but 19 confident falsehoods; three exclusions brought it to 44.3% with
confFalse back at the pre-readout 4 (all four are perception-path garbage
commitments, none from the ledger): (1) **hypothetical** - edges/contrasts
from if/then sentences are rule content, not asserted facts ("if X then the
dog is green" must not make "is the dog green?" affirmable; -6 confFalse);
(2) **pairScoped** - the verb->object half of a reified SVO shares its verb
node across assertions, so chaining through it manufactures facts ("mouse
visits cat" + "dog visits squirrel" affirmed "mouse visits squirrel";
-8 confFalse); (3) **polarity-loss guard** - a negated question whose parse
drops its contrast (reflexive "the dog does not need the dog") must be
silence, not an affirmation of the positive residue (-1 confFalse). The gains
concentrate exactly where the ledger is sound: proofwriter.d0 fact lookup
41.7% -> 83.3%. Rule-hop depth (d1+) stays with the reasoning engine
(PARITY §3.2), as it should.

The flag-ON pin was accepted via `--accept` over two family-level regression
flags (honest.proofwriter.d2 balAcc −8.3pp, honest.proofwriter.d5 confFalse
0→1): the per-item diff showed 7 honest verdict changes, 6 of which were
garbage token-soup commitments becoming clean abstentions (−2 confident
falsehoods, +2 correct unknowns) and 1 the reverse; the family dips are
verdict-mapper coin flips on garbage answers, not capability loss. Fast-mode
numbers are identical on both sides of the flag (the flag only touches the
assertion-ingestion path).

The first 2026-07-23 pin (rule discharge, TEXT_GRAPH_RULE_DISCHARGE_ENABLED)
was accepted via `--accept` over two flags (honest.ruletaker.d2 confFalse
0→1, honest.overall confFalse 4→5). Audit: all 5 confident falsehoods were
perception-path token-soup commitments on Rel* (verb-relational) items -
GraphQuery was silent there by design (pair-scoped firewall), so the
discharge closure never ran for any of them. The new rt.d2 offender
(RelNoneg-D2-1879-6) was ablated single-item and found byte-identical with
the discharge flag on and off, pointing at the perception path itself as
the actual source - which the next fix addresses directly.

**The second 2026-07-23 pin (superseding the first, same day) fixes the
perception-path source and adds relational discharge - confFalse 5→0,
balAcc 68.1%→83.8%, no regression flags, no `--accept` needed.** Two
mechanisms:

1. **Perception-gate scoping.** `perceiveCoherent` (the live query path) had
   never run the Phase 2 emission gate - only `perceive()` had, and every
   measured token-soup confident falsehood came through the ungated path.
   Gating it outright regressed the number-line vault-recall suite (a
   cache-hit answer failing a geometric coherence bar calibrated for raw
   settling), so the gate is scoped to exactly the two untrusted-provenance
   tiers where token soup actually originates - `"cluster"` and `"geodesic"`
   (raw settling arrival with no symbolic/vault backing) - leaving vault,
   reduction, formula, composition, and rule-discharge answers ungated (they
   are constructor-guaranteed or crystallized-proof mechanisms, not
   candidates needing geometric re-verification).
2. **Relational (SVO) rule discharge.** Pair-exact triples
   (`system.textGroundedTriples` / `textGroundedTriplesNeg`, keyed
   `${subject}|${verb}|${object}`) are the sound complement to the
   pairScoped edge exclusion: a triple is scoped to its own assertion, so it
   can be affirmed/denied exactly without bridging assertions through the
   shared verb node the way chaining did. `GroundRule`/`RuleAtom` gained an
   optional `verb` field so relational conditions/conclusions ("if someone
   chases the cat then they like the dog") extract and discharge exactly
   like attribute rules, including mixed attribute+relational conditions and
   ground-conclusion existential binding ("if someone chases the hen and
   they are sly then the hen is scared"). Required an accompanying parser
   fix: compromise mis-tags 3rd-person-singular verbs as plural nouns ("the
   tiger chases the cat" → chases[Noun,Plural]), which had silently degraded
   every such clause to a bare NP fragment - `recoverMistaggedVerb` detects
   and recovers it.

**A false start worth recording:** an intermediate version of this pin added
a "reflexive-derivation guard" refusing to derive self-loops like
`chase(tiger, tiger)` from variable unification ("if someone sees the cat
then they chase the tiger" firing with subject=tiger), reasoning they were
manufactured rather than intended. **That guard was wrong.** Checking gold
labels directly: every reflexive relational question in
`ruletaker_sample.jsonl` ("the cow visits the cow", "the tiger chases the
tiger", "the squirrel eats the squirrel", ...) is gold=`true` - RuleTaker's
official semantics genuinely derives them this way, and the guard was
silently flipping correct derivations to wrong denials once combined with
closed-world mode (confFalse 5→16 on the guarded+CWA measurement). The guard
was removed; `tests/rule_discharge.test.ts` now pins the reflexive case as
sound, with a regression note against reintroducing the guard without
re-checking gold first.

**Closed-world mode (PARITY §3.2 stage 2) is built but NOT enabled here.**
`TEXT_GRAPH_CWA_ENABLED` exists (default false) with negation-as-failure and
the parse-completeness safety valve, guarded in `tests/rule_discharge.test.ts`
in isolation. A per-dataset harness toggle (RuleTaker=CWA, ProofWriter=OWA,
matching each task's own world assumption) was tried and measured
confFalse 5→16, concentrated in ruletaker.d2/d3/d5 - it has not cleared its
own gate, so the harness leaves it off for every dataset per the covenant
("ship flag-off and iterate off the diff"). This is why ruletaker false-
recall (60-75% balAcc, not higher) is the visible residual in the pinned
numbers: OWA correctly cannot deny a fact it merely fails to derive.

> **⚠ The confFalse 5→16 measurement above is CONFOUNDED - do not cite it as
> evidence about CWA.** It was taken against a tree that still contained
> BOTH defects fixed later the same day in `87fca2a`: (1) the
> reflexive-derivation guard, proven WRONG against gold labels, which by
> this file's own account was "silently flipping correct derivations to
> wrong denials **once combined with closed-world mode**" - i.e. the guard's
> damage was *measured through* the CWA run and attributed to CWA; and (2)
> the ungated `perceiveCoherent` path that produced all 5 confident
> falsehoods in that run's own baseline. The `5` and the `16` are both
> pre-fix numbers. See the 2026-07-30 re-measurement below.

## 2026-07-30 - audit baseline, valve reach, and the CWA re-measurement

Three measurements against `f39f5e2` (PARITY §5 next-steps 1-3), all with
per-item checkpoints so later diffs need no re-run.

**1. Audit baseline (`baseline_owa.checkpoint.jsonl`).** The pinned
configuration re-run with `--checkpoint --no-pin`. It reproduced the pin
**exactly** - all ten families plus overall, 83.8% / 33.8% / confFalse 0,
byte-identical aggregates. The pipeline is deterministic across runs at this
configuration, and there is now a committed per-item reference for every
future diff (previously the audit trail was aggregates only, so explaining a
regression required a full re-run to reconstruct "before").

Residual composition, which the family aggregates cannot show:

| bucket | n | abstain | confFalse |
| ------ | - | ------- | --------- |
| proofwriter gold=true | 20 | 0 | 0 |
| proofwriter gold=false | 20 | 2 | 0 |
| proofwriter gold=unknown | 20 | 20 (correct - abstention IS the gold) | 0 |
| ruletaker gold=true | 50 | 13 | 0 |
| ruletaker gold=false | 50 | 19 | 0 |

Two consequences. ProofWriter is effectively solved (58/60; its 33.3%
abstention floor *is* the gold-unknown third answered correctly). And on
RuleTaker, balanced accuracy equals `1 − abstentionRate` at every depth,
which is only possible because **every committed answer on all 100 items is
correct** - the deduction residual is 34 items of pure silence and zero
error.

**2. Parse-completeness valve reach.** CWA denial is double-gated on
`TEXT_GRAPH_CWA_ENABLED && textGroundedUnparsed === 0`, so a theory with one
unreadable sentence is CWA-ineligible regardless of the flag. Measured
per item (now recorded in every checkpoint): **156/160 eligible (97.5%)** -
ruletaker 98/100, proofwriter 58/60 - and **19/19** of the CWA-target class
(ruletaker, gold=false, abstained) is eligible. The valve is not what limits
closed-world mode; its ceiling is essentially the whole corpus. Had this
come out low, the next item would have been parser coverage (PARITY §3.1
residual) rather than CWA.

**3. CWA re-measured on the fixed tree (`cwa.checkpoint.jsonl`).** Same
per-dataset toggle as the reverted attempt - RuleTaker closed-world,
ProofWriter open-world - now behind `--cwa` (which implies `--no-pin`, so an
exploratory run can never move the pin). Honest mode:

| | balAcc | abstain | confFalse |
| - | ------ | ------- | --------- |
| OWA (pinned) | 83.8% | 33.8% | 0 |
| **CWA (RuleTaker only)** | **96.7%** | **16.3%** | **1** |

Per depth, ruletaker: d0 70→95%, d1 60→95%, d2 65→95%, d3 75→**100%**,
d5 70→90%. ProofWriter is byte-identical across the two runs - the correct
control, confirming the toggle is scoped to the dataset whose task
definition is closed-world.

Per-item classification (`scripts/dev/checkpoint_analysis.ts`, OWA→CWA):
**27 GAIN** (silence→correct), **1 BROKE**, **0 LOSS**, 0 CHURN, 0 FIX.

**The confFalse 5→16 characterization is refuted.** On a tree without the
wrong reflexivity guard and without the ungated perception path, the same
mechanism yields +12.9pp balanced accuracy at **one** confident falsehood,
not eleven more. Nearly all of the reverted attempt's damage belonged to the
two defects it was measured through.

**The one break, and why it is the interesting result.**
`RelNeg-D5-254-12` (gold=false, "The bald eagle is not big") went
abstain→affirm with GraphQuery's negated-question denial surface
("correct, bald eagle is not big"), i.e. CWA denied `big(bald eagle)` as
non-derivable. It IS derivable, at depth 5:

```
  cow does not visit cat            (asserted)
  -> cat needs dog                  (if cow does not visit cat then cat needs dog)
  -> dog is kind                    (if something needs the dog then the dog is kind)
  -> dog needs cat                  (if something is kind then it needs the cat)
  -> dog needs bald eagle           (if something needs the cat AND the cat is not
                                     kind then it needs the bald eagle)   <-- NAF here
  -> bald eagle is big              (if the dog is kind and the dog needs the bald
                                     eagle then the bald eagle is big)
```

The chain needs negation-as-failure on "the cat is not kind" as an
INTERMEDIATE step feeding a positive conclusion - nested NAF, which is
exactly where the closure's stratification approximation (alternating
`firePass(false)` / `firePass(true)`, GraphQuery.ts) is weakest. Leading
hypothesis, not yet isolated; `MAX_RULE_ITERATIONS = 16` is not the limit
(the chain is 5 hops).

**The structural lesson, which outlives this item:** under open-world
semantics incompleteness is SAFE - a derivation the engine cannot complete
becomes silence, and silence is scored as abstention. Under closed-world
semantics incompleteness is UNSAFE - every gap in the closure is
indistinguishable from a fact that is genuinely underivable, so it converts
directly into a confident falsehood. CWA does not add a new way to be
wrong about logic; it removes the safety margin that was hiding the
derivation gaps. That is why it trades 27 gains for 1 break rather than
being uniformly good or bad, and it means CWA's true prerequisite is
closure COMPLETENESS, not more closure soundness.

## 2026-07-30 (later) - the break is closed; CWA clears its gate

Two defects, both invisible under open-world semantics because both produce
silence there and only turn into falsehood once CWA removes the margin.

**1. The `pairScoped` stamp was being stripped** (`TextGraph.ts`). One graph
is built per THEORY, so `seenEdges` spans every sentence; the dedup branch
cleared `pairScoped` whenever the same `(from,to,kind)` recurred in a role
that did not set it, re-opening the reified verb node for the whole ledger.
Measured effect: `cat -> visit -> cow -> kind` made "the cat visits the cow"
+ "the cow is kind" affirm **"the cat is kind"**. The stamp is now monotone.
`hypothetical` keeps its upgrade semantics - the two are different kinds of
claim: `hypothetical` is truth provenance (an asserted occurrence really does
outrank a rule mention), `pairScoped` is structural scope (no other sentence
can make chaining through a shared verb node safe).

**2. Entity aliasing across the delegation boundary.** `buildGraphFromText`
delegates single-clause statements to LogicGraph, whose `relationOrContrast`
interns raw regex captures ("the bald eagle is not big" -> `bald eagle`),
while content-verb SVO falls through to the grammatical pass, where
`collectNpGroups` interns the HEAD NOUN (`eagle`). Two parsers, two noun-
phrase conventions, one entity, two precepts. The closure correctly derived
`big(eagle)`; the question resolved to `bald eagle`; non-derivability there
meant nothing about the theory. 23/160 items (14%) contain a multi-word
entity, so this is a class, not a one-off - it is simply invisible under OWA,
where it costs silence instead of correctness.

**The completeness gate** (`entityAliased`, GraphQuery) withholds CWA denial
when another allocated ledger precept plausibly denotes the same entity. It
is applied ONLY on the denial branches, so open-world behaviour is unchanged.
This is the general principle stated above made operational: denial-from-
absence is sound only if the closure saw everything the theory knows about
the subject, and a split entity guarantees it did not.

Measured, honest mode, all 160 items:

| configuration | balAcc | abstain | confFalse |
| ------------- | ------ | ------- | --------- |
| OWA (pinned) | 83.8% | 33.8% | 0 |
| CWA, ungated | 96.7% | 16.3% | 1 |
| **CWA + completeness gate** | **96.7%** | 16.9% | **0** |

Per depth: ruletaker d0/d1/d2 95%, d3 **100%**, d5 90%; proofwriter
unchanged as the control. Per item vs the OWA pin: **27 GAIN, 0 BROKE,
0 LOSS, 0 CHURN**. No regression flags, no `--accept`.

Two honest qualifications. (a) The gate did not buy ACCURACY - balanced
accuracy is 96.7% with or without it, because a gold-`false` item scores zero
recall whether it is answered wrongly or abstained. It bought the COVENANT,
which is the whole difference between shippable and not. (b) The
`pairScoped` fix produced no measurable movement on these 160 items beyond
letting the chain derive; its value is removing a latent unsoundness class
this corpus happens not to probe. Neither should be credited with more than
it did.

Still open: the gate makes aliasing SAFE, not FIXED. Those 14% of items
remain split across precepts and are now silent rather than wrong. Recovering
that abstention means reconciling the two noun-phrase conventions - either
narrowing LogicGraph delegation to genuinely symbolic surface, or routing its
captures through the same NP-head extraction the grammatical pass uses.

**Disposition: CWA now clears the covenant's red line** (confFalse 0) and is
enabled per dataset by `--cwa`. The default remains open-world and the pin is
unmoved, because the world assumption belongs to the task, not the engine -
ProofWriter is genuinely open-world and must keep abstaining. The
reproduction:

```bash
tsx tests/benchmarks/external_benchmarks.ts --datasets \
  --checkpoint data/benchmarks/baseline_owa.checkpoint.jsonl --no-pin
tsx tests/benchmarks/external_benchmarks.ts --datasets \
  --checkpoint data/benchmarks/cwa_gated.checkpoint.jsonl --cwa
tsx scripts/dev/checkpoint_analysis.ts \
  data/benchmarks/baseline_owa.checkpoint.jsonl \
  data/benchmarks/cwa_gated.checkpoint.jsonl
# single-item isolation of the break, with the closure dumped:
tsx scripts/dev/probe_cwa_break.ts
```

(`cwa.checkpoint.jsonl` is the pre-fix run, retained so the 1 -> 0 confFalse
move stays auditable per item.)

Final per-family movement from the 44.3% baseline: proofwriter d0
83.3%→100%, d1 41.7%→91.7%, d2 41.7%→100%, d3 41.7%→100%, d5 41.7%→91.7%
(confFalse 0 throughout); ruletaker d0 55%→70%, d1 5%→60%, d2 15%→65%,
d3 0%→75%, d5 10%→70% (confFalse 0 throughout, down from 1 each).
