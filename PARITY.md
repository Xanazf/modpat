# PARITY.md - Distance to flagship-LLM parity on deterministic tasks

Written 2026-07-05, against the tree at `e9e6fe2` + the seedCapabilities fix.
Updated 2026-07-23 against `7054f59`: the honest external baseline has been
run (§2 update) and the §3.1 route-(a) first cut is built and guarded.
Updated again 2026-07-23 (same day): §3.2's first iteration - attribute-rule
discharge over the text ledger, then a perception-gate scoping fix and
relational (SVO) discharge - is built, guarded, and pinned at 83.8% balAcc,
confFalse 0 across all 160 items (§2 second update).
Every claim below is tagged **measured** (a number exists in this repo),
**referenced** (a number exists in the literature, coarse), or **theorized**
(an argument, to be graded like the ROADMAP's on-the-record predictions).

## 1. Scope: what parity means here

Deterministic tasks only: propositional and first-order inference, arithmetic,
code with checkable behaviour, closed-world KB query, structured-scene query.
Open-ended generation, style, and web-scale world knowledge are out of scope -
the thesis never claimed them.

Parity is operationalized as:

> Match or beat a flagship LLM on the standard deterministic benchmark
> families (ProofWriter/RuleTaker-class deduction, FOLIO-class FOL,
> grade-school arithmetic word problems, HumanEval-class function synthesis)
> **at comparable natural-language surface**, while keeping the two properties
> the LLM cannot offer: errors with addresses, and principled abstention.

The last clause matters: abstention is scored separately, not as failure.
A system that answers 90% and abstains on 10% is not equivalent to one that
answers 100% with 10% confident falsehoods - on deterministic tasks it is
strictly better. Parity accounting must be balanced-accuracy-with-abstention,
the gate's native metric (measured: 100% on the 17-case calibration corpus).

## 2. Where we stand (measured, 2026-07-05)

Internal (from ROADMAP Status, all guard-tested):

| metric | value |
| ------ | ----- |
| static grounding pearson | 0.944 |
| traversal onPath | 0.95 |
| coherence gate balanced accuracy | 100% (17 cases) |
| behavioural fidelity (arith / code-as-arithmetic-through-tsx) | 1.000 / 1.000 |
| closed-world fidelity (logic) | 0.844 baseline |
| propositional suite | 6/6 |

External families (inline samples modelled after the real datasets,
`tests/benchmarks/external_benchmarks.ts`, 2026-06-30):

| family | score | n |
| ------ | ----- | - |
| RuleTaker-style overall | 0.87 | ~20 |
| ... hop-1 (naturalistic surface) | 0.60 | 5 |
| ... hop-3..5 (symbolic chains) | 1.00 | 7 |
| ProofWriter-style chain completion | 0.833 | small |
| Logical-NLI entailment/contradiction | 1.00 | small |

Flagship reference points (referenced, coarse, as of knowledge available
in-repo): fine-tuned transformers reached ~99% on RuleTaker years ago;
flagship chat models with chain-of-thought sit high-90s on ProofWriter
depth-5, near-ceiling on small arithmetic, 90%+ on HumanEval, and notably
lower (70s-80s) on FOLIO-class FOL.

**Honesty caveat, load-bearing:** the external numbers above are inline
samples authored in this repo - parse-relative in exactly the sense Phase 4.5
warns about. No number here is a parity claim until the actual dataset files
run through the pipeline. That run is the single cheapest next step (days,
engineering only) and it sets the honest baseline every other estimate hangs
off.

**Update (2026-07-21, measured): the baseline has been run.** 160
RuleTaker/ProofWriter items, actual dataset files (`data/benchmarks/`,
pinned via `--accept`). Balanced accuracy / abstain / confident falsehoods:
33.8% / 90.6% / 7 with text-graph ingestion OFF; 36.2% / 93.8% / 4 with the
§3.1 write side ON; **44.3% / 83.1% / 4** with the GraphQuery read side ON
(the pinned configuration). proofwriter depth-0 fact lookup 41.7→83.3%; all
four remaining confident falsehoods are perception-path garbage, none from
the ledger. The inline-sample table above is retained for history but
superseded: 44.3% at confFalse 4 is the number every estimate now hangs off,
and the residual distance is rule-hop depth (§3.2), not fact lookup.

**Second update (2026-07-23, measured): the rule-hop wall is down AND the
perception-garbage class is fixed.** §3.2's first iteration (attribute-rule
extraction + query-time open-world fixpoint discharge,
`TEXT_GRAPH_RULE_DISCHARGE_ENABLED`) first moved the honest overall to
68.1% / 51.2% / 5 - all 5 confident falsehoods perception-path token soup on
Rel* items the discharge closure never touched. Two further mechanisms then
took confFalse to **zero**: (1) scoping the Phase 2 emission gate onto the
live query path (`perceiveCoherent`), which had never run it - narrowed to
the two untrusted-provenance tiers (`cluster`/`geodesic`, raw settling with
no symbolic backing) after gating everything regressed vault-recall
answers on an unrelated corpus; (2) relational (SVO) rule discharge over a
pair-exact triple ledger (`textGroundedTriples`/`textGroundedTriplesNeg`),
the sound complement to the pairScoped edge exclusion, which lifted the
Rel* silence directly. Final: **83.8% / 33.8% / 0**, no regression flags,
no `--accept` needed. Per-family: proofwriter d0/d2/d3 100%, d1/d5 91.7%
(confFalse 0 throughout); ruletaker d0 70%, d1 60%, d2 65%, d3 75%, d5 70%
(confFalse 0 throughout, down from 1 each). Full mechanism writeup and a
recorded false start (a reflexive-derivation guard that was measured
WRONG against gold labels and removed) in `data/benchmarks/README.md`.
Residuals: closed-world negation-as-failure (§3.2 stage 2) is built but
NOT enabled in the harness - a per-dataset toggle regressed confFalse to 16
and was reverted, so it needs more work before it can claim ruletaker's
remaining false-recall gap; relational rules cover SVO but not
prepositional/multi-clause relations.

**Third update (2026-07-30, measured): the residual is pure silence, and
the CWA regression that motivated the last prediction was an artifact.**
Three runs against `f39f5e2`, all with per-item checkpoints
(`data/benchmarks/*.checkpoint.jsonl`, analysed by
`scripts/dev/checkpoint_analysis.ts`):

1. **The pinned configuration reproduces exactly** - all ten families plus
   overall, 83.8% / 33.8% / 0, byte-identical. Decomposing the residual by
   gold class shows balanced accuracy equals `1 − abstentionRate` at every
   RuleTaker depth, which is only possible because **every committed answer
   on all 100 RuleTaker items is correct**. ProofWriter is effectively
   solved (58/60; its 33.3% abstention floor IS the gold-unknown third,
   answered correctly). The whole deduction gap is 34 items of silence and
   zero error.
2. **The parse-completeness valve is not the limit.** CWA denial is
   double-gated on `textGroundedUnparsed === 0`; measured, the valve is open
   on 156/160 items (97.5%) and on 19/19 of the CWA-target class.
3. **CWA re-measured: 83.8% → 96.7% balAcc, abstention 33.8% → 16.3%,
   confFalse 0 → 1** (27 items silence→correct, 1 break, 0 losses;
   ProofWriter byte-identical as the control). The old "confFalse 5→16" is
   **refuted as a characterization of CWA**: that measurement was taken
   through two defects fixed hours later at `87fca2a` - the reflexive-
   derivation guard proven wrong against gold (whose damage this repo's own
   notes describe as appearing "once combined with closed-world mode") and
   the ungated `perceiveCoherent` path that produced all 5 of that run's
   baseline confident falsehoods.

The single break (`RelNeg-D5-254-12`) is diagnostic rather than incidental:
CWA denied a fact that IS derivable at depth 5 via a chain whose fourth hop
needs negation-as-failure as an INTERMEDIATE step. Which yields the finding
that should govern the next iteration: **under OWA, incompleteness is safe -
a derivation the engine cannot finish becomes silence. Under CWA it is
unsafe - every gap in the closure is indistinguishable from a genuinely
underivable fact and converts straight into a confident falsehood.** CWA
does not add a new way to be wrong about logic; it withdraws the margin that
was concealing the closure's derivation gaps. Its true prerequisite is
closure COMPLETENESS, not further soundness work.

**Fourth update (2026-07-30, same day, measured): the break is closed and
CWA clears its gate at 96.7% / confFalse 0.** Isolating the break found two
defects, neither of them the stratification approximation that was the
leading hypothesis, and both invisible under OWA because both cost silence
there rather than correctness:

1. **The `pairScoped` stamp was stripped on dedup** - one graph is built per
   theory, so a single recurrence of the same edge in a role that did not set
   the stamp re-opened the reified verb node for the whole ledger, letting
   "the cat visits the cow" + "the cow is kind" affirm "the cat is kind".
   Now monotone (`hypothetical` legitimately upgrades; `pairScoped` is
   structural scope and cannot be upgraded by another sentence).
2. **Entity aliasing across the LogicGraph delegation boundary** - delegated
   single-clause statements intern raw regex captures (`bald eagle`) while
   the grammatical pass interns the head noun (`eagle`), so one entity holds
   two precepts. The closure derived `big(eagle)`; the question resolved to
   `bald eagle`. 23/160 items (14%) contain a multi-word entity.

The completeness gate (`entityAliased`) withholds CWA denial when the subject
is aliased, on the denial branches only - OWA is unchanged. Result:

| configuration | balAcc | abstain | confFalse |
| ------------- | ------ | ------- | --------- |
| OWA (pinned) | 83.8% | 33.8% | 0 |
| CWA, ungated | 96.7% | 16.3% | 1 |
| **CWA + gate** | **96.7%** | 16.9% | **0** |

27 GAIN / 0 BROKE / 0 LOSS / 0 CHURN against the pin; ruletaker d3 at 100%.
Two qualifications kept explicit: the gate bought the COVENANT, not accuracy
(balAcc is 96.7% either way - a gold-false item scores zero recall whether
answered wrongly or abstained), and the `pairScoped` fix moved nothing
measurable on these 160 items beyond letting the chain derive. The default
stays open-world and the pin is unmoved: the world assumption belongs to the
task, not the engine.

**Fifth update (2026-07-30, same day, measured): aliasing fixed at the
source; the deduction family stands at 97.6% / confFalse 0.** Both parsers
already shared one `ensure` (TextGraph's builder extends LogicGraph's), so
the fix is one line at that seam: multi-word Term labels reduce to their head
noun - the convention the grammatical pass already used. Chosen over
narrowing LogicGraph delegation because the subsumption guard compares the
two builders BY LABEL, so changing `ensure` moves both sides together while
removing delegation would let them diverge. Coordinated spans are exempt
(only a simple NP has one head), tested on the raw span because `lemma()`
drops the coordinator.

| configuration | balAcc | abstain | confFalse |
| ------------- | ------ | ------- | --------- |
| OWA (new pin) | 84.3% | 33.1% | 0 |
| **CWA** | **97.6%** | 15.6% | 0 |

ruletaker d3 and d5 at 100%; 29 GAIN / 0 BROKE / 0 LOSS / 0 CHURN against the
pin. The `entityAliased` gate was DELETED rather than kept: with single-word
labels it is unreachable, and an untestable safety net is worse than a
documented absence.

**Sizing correction, on the record:** the 14% of items containing a
multi-word entity was offered as an upper bound on what this fix might
recover. It recovered 2 items. That figure measured exposure, not harm - the
split only cost anything where a derivation had to cross both halves - and
should not be cited as the fix's value.

Residual deduction distance is now 15.6% abstention with zero error:
proofwriter d1/d5 at 91.7%, ruletaker d0/d1/d2 at 95%.

### Update, 2026-07-31: aux-fronted questions with multi-word subjects

The front-end defect noted above as deliberately unfixed - `questionToProposition`
canonicalizing "is the bald eagle red?" to "the bald is eagle red" - is fixed.
Its subject/predicate split counted words (a lazy quantifier took the shortest
leading NP); it now reads compromise's tags, the same tagger both graph parsers
already trust. The rule is the maximal leading determiner/adjective/noun run,
where a determiner may only OPEN the run, cut at the run's RIGHTMOST head -
the same right-headedness `npHead` uses to intern one entity to one precept,
applied to the split rather than to the label.

**This measured exactly zero on the benchmark, as predicted before the work
started.** All 160 items ask declaratively ("Anne is nice."); 0 are
aux-fronted. OWA stayed at 84.3% / 33.1% / confFalse 0 and CWA at 97.6% /
15.6% / confFalse 0, byte-identical to the pin. It is a live-conversational-path
fix, verified by guard tests over every question surface in the test corpus,
and it is worth recording that the benchmark was incapable of catching either
the defect or the fix.

**What the tags actually cost, on the record.** Two failures were found by
sweeping surfaces, not by reasoning, and both are the tagger being wrong
rather than the rule being wrong:

- Mid-string articles are mis-tagged - "felix an animal" tags `an` as a bare
  Noun, "felix the animal" tags `the` as Noun,ProperNoun,Person. Articles are
  matched by SURFACE now; they are a closed class of three, which is the kind
  of lexicon this module already permits.
- The subject itself can be mis-tagged: "bob rich" reads `rich` as a
  comparative and so tags `bob` an imperative Verb, leaving no head at all.
  Position is the fallback - after an auxiliary, the next token is the subject
  however it got tagged. That reproduces the old regex exactly, so it degrades
  only where tags were already untrustworthy.

Two residuals, both accepted and neither a regression: a three-noun surface
("are fire trucks vehicles") is genuinely ambiguous under tags alone, and
compound-noun subjects still cut at the rightmost head. Resolving either needs
the tokens to reach `parseClause` **un-round-tripped** - folding aux-fronting
into the clause parser, so questions and statements share one NP chunker
instead of meeting through a string. That is the honest end state and this is
not it; the string round-trip is the actual smell, and it survives.

### Update, same day: aux-fronting folded into `parseClause`

Done - with one correction to the paragraph above, which was wrong about why.

`parseClause` now undoes interrogative word order itself, on tagged tokens,
behind `TextGraphOptions.interrogative`. A question reaches the same clause
logic and the same `collectNpGroups` as the statement it asks about, and
`buildGraphFromText("is the bald eagle red", { interrogative: true })` produces
an edge set identical to the statement's (guarded). `resolveGraphQuery` parses
the QUESTION now; the declarative string it still produces is the answer
surface only, and comes from the same rotation, so the surface an answer
echoes and the graph it was verified against cannot drift apart.

The flag is not timidity. `buildGraphFromText` is the ingestion path, and a
statement opening with an auxiliary would otherwise be silently rewritten
before being asserted - silent knowledge corruption, against a standing "asking
never creates" invariant. No corpus sentence does this (0 of 2291 benchmark
theory sentences, measured), which is an argument for the gate being free, not
for omitting it.

**Where the previous entry was wrong: the string round-trip was not a smell,
and removing it made the parse worse.** compromise is ORDER-SENSITIVE, and
rotation leaves the tags stale:

| surface | `fish` | `fly` |
| --- | --- | --- |
| `can fish swim` | **Verb** | - |
| `fish can swim` | Noun | - |
| `can felix fly` | - | **Noun** |
| `felix can fly` | - | Verb |

The tagger is trained on declarative English, so a rotated clause is a *better*
sentence to tag than the question it came from - which is in turn better than
the aux-stripped remainder the string version had to use. Rotating without
re-tagging parses "can fish swim" with `fish` as the verb: a silently wrong
graph behind a correct-looking surface. So the rotation now re-tags, and the
re-parse is load-bearing rather than incidental. The ranking that actually
holds is **rotated declarative > full interrogative > decapitated remainder**,
and the three implementations of this function have now occupied all three
rungs, in that order.

Two claims from the previous entry are retracted:

- "the tokens must reach `parseClause` un-round-tripped" - they must reach it
  RE-TAGGED, which is the opposite.
- "keeping the aux through tagging removed that whole failure class, and with
  it the positional fallback" - the fallback is load-bearing. "can fish swim"
  tags `fish` a Verb, so the tags deny there is a subject at all, and only
  position finds the boundary that makes the rotation (and hence the recovery)
  possible. I removed it on that reasoning and the sweep caught it.

Measured: OWA 84.3%/33.1%/confFalse 0, CWA 97.6%/15.6%/confFalse 0, **0 BROKE /
0 GAIN / 0 LOSS / 0 CHURN** per item. Behaviour-preserving, as a refactor
should be. The two residuals above are unchanged - three-noun ambiguity and
compound-noun subjects survive, and now demonstrably cannot be fixed by moving
the boundary logic around, only by a real NP parser.

### Update, 2026-08-01: the code family gets its honest baseline - it is zero

§3.5 was the largest remaining item (35% of the distance) and the only one
still costed entirely from theory. It now has the same kind of number the
deduction family got on 2026-07-21, produced the same way: the actual dataset
files through the pipeline, with execution as the oracle.

**The dataset.** All 159 problems of MultiPL-E's TypeScript translation of
HumanEval, vendored at `data/benchmarks/humaneval_ts.jsonl`
(`scripts/dev/fetch_code_benchmark.ts`). TypeScript rather than the original
Python because §3.5's asset is "tsx execution = free territory contact" - the
candidate is spliced into the official prompt and run by the official tests in
a child process that never sees a manifold coordinate, which is the same
non-circularity `CodeBehaviouralFidelity.ts` claims for arithmetic, and it only
holds in a language this repo executes.

**First, a correction to §2's own table.** The "behavioural fidelity (arith /
code) 1.000 / 1.000" row has been read as a code-synthesis result. It is not.
That channel parses `a + b` / `a - b`, predicts the reduct from grounded W
positions, and checks it against tsx - it never touches the Synthesizer's
emitted text. The 1.000 is real and it is about arithmetic; it says nothing
about whether the engine can write a function, and §3.5's estimate should never
have had it nearby.

| configuration (n=159) | pass@1 | abstain | confFalse |
| --------------------- | ------ | ------- | --------- |
| cold vault, name surface | **0.0%** | 93.1% | 11 |
| stdlib-primed, name surface | **0.0%** | 93.1% | 11 |
| stdlib-primed, doc surface | **0.0%** | 31.4% | 109 |

The headline zero is the least informative part. Three measured findings:

1. **Not one emission was a program.** Inspecting all 477 item-runs: the
   `fail` bucket is bare English words (`is_prime` → `"prime"`), which parse
   only because a lone identifier is a valid expression statement; the
   `invalid` bucket is English prose. The honest claim is not "0% pass@1" but
   **the code path does not currently emit code for HumanEval-class input.**
2. **Priming is not the lever.** Cold and stdlib-primed are byte-identical in
   every emitted string on all 159 items (0 disagreements, measured).
   Ingesting 90 code patterns changes nothing, because retrieval keys on an
   abstracted signature plus a grid window around the query centroid, and an
   unseen intent phrase lands outside the window.
3. **The reading/writing inversion, one layer further in.** §3.1 opened this
   document with "the reasoning engine is not what loses; the reading is." For
   code the round-trip probe isolates the other half: ingest the Stage-1
   corpus, ask each function back **by the intent phrase ingestion itself
   minted for it**, and execute the result. On 29 functions the engine had
   literally just been shown, pass@1 was **0%** with 12 confident falsehoods.
   Nothing about reading is involved. Here it is the **writing** that loses:
   the vault stores code as a token sequence, so `+` comes back as `plus`
   (BaseAtomizer canonicalizes symbol and word forms to one scope - correct
   for arithmetic language, destructive for source text), `decodeSequence`
   space-joins punctuation, and every identifier returns as an unbound `_`.

So the §3.5 residual is not "synthesize control flow and data structures", as
the section has said since 2026-07-05. Control flow is already stored
correctly - the retrieved templates have the right `if`/`for` shape. The engine
cannot get a function it already holds back out through its own storage medium.

**One fix landed, and it buys the covenant rather than capability.** A code-
channel emission gate (`_emissionIsProgram`, `Perception.ts`) parses the
instantiated template and abstains on what does not parse. Round-trip
confFalse **12 → 4**, `invalid` **8 → 0**, abstention 58.6% → 86.2%, pass@1
**0.0% either way**. Scoped to retrievals with non-zero `slotFlags` (actual
code patterns): `|-` is the general inference sink, so an ungated version would
silence any English vault recall reaching the same fast-path - the regression
the perception-gate scoping work already documented.

**It is a recorded capability reduction, not a free win.** `pcs_e2e`'s step 4
asserted that synthesis returns something containing "function" or "return",
and it passed on `function add ( _ _ ) { return _ plus _ ; }` - certifying
structure it never checked. That case is now an abstention. The test was
rewritten to pin the invariant (*parseable code or abstention, never text
shaped like code*) rather than the current answer, so restoring emission makes
it pass on the code branch without being edited.

**A methodological caveat that must travel with the doc-surface 109.** The
engine has no way to know it was asked for code. `|-` is the general inference
sink, so a code request that misses the vault is handled as a deduction
request and answered in English - the settling path doing its job. Scoring that
as a confident falsehood charges the engine for the harness's framing. It stays
in the column because under a synthesis contract a non-program answer is a
failed commitment, but the underlying defect is **the code channel has no
request type**, and that belongs to §3.5.

On the record, a gradable prediction: **the code family's binding constraint is
emission fidelity, not synthesis intelligence - restoring a lossless code
round-trip (a detokenizer that inverts the symbol/word canonicalization for
code-scoped sequences, plus real slot bindings so identifiers are not `_`)
takes the round-trip probe from 0% to >80% pass without any new reasoning
mechanism, and HumanEval pass@1 stays near zero until it lands.** Wrong-if:
either a full emission fix leaves the round-trip probe below 80% (the loss is
not in the medium but in retrieval or composition), or HumanEval pass@1 moves
materially above zero from work that does not touch emission at all.

### Update, same day: the emission is fixed, and the prediction is falsified

The fix landed in full - detokenizer plus real slot bindings, exactly as
scoped - and the round-trip probe went **0% → 24.1% pass@1** at unchanged
confident falsehoods, with `invalid` at zero. Emitted code is now correct,
canonically-formatted TypeScript. Mechanism detail is in
`data/benchmarks/README.md`; the three parts worth carrying here:

1. **Spacing was never a loss.** The baseline entry above lists "punctuation is
   space-joined" as one of the three defects. It is not one: JavaScript is
   whitespace-insensitive, so the space-joined form already parses and
   re-printing it is free. Only the operator-word and case losses were real.
2. **The information needed was already being computed and thrown away.**
   `extractPatternFromNode` has always produced `varNames`, the original
   identifier for every slot; `processCode` discarded them. Persisting them
   (`var_names` on `wave_forms`) is what restores case - including member names
   like `.push`, which no inverse map could recover.
3. **A real encoding bug surfaced**: `target_pattern` joins tokens with "," and
   splits on ",", so a literal comma token was destroyed by its own delimiter -
   `function f(a, b)` came back as `function var_0 ( var_1 var_2 )`. Invisible
   while the vault held only English.

**Graded: FALSIFIED on its bar, and its own wrong-if named why.** 24.1% is not
>80%. The stated alternative - "the loss is not in the medium but in retrieval
or composition" - is what actually holds. The decomposition:

| | n | |
| --- | --- | --- |
| probes that retrieved a code pattern at all | 8 / 29 | 28% |
| of those, emitted correct executable code | 7 / 8 | **87.5%** |

So emission fidelity conditional on retrieval is ~87.5%, and the 24.1% ceiling
is retrieval firing on barely a quarter of queries. Emission was *a* binding
constraint - fixing it alone moved 0 → 24.1% - but not *the* binding
constraint, and the prediction claimed the latter. A confirmed direction
reached at a quarter of the claimed magnitude is a miss, not a hit.

**What the fix exposed is more useful than what it fixed.** The first fixed run
measured confFalse 5, and this repo's own regression guard refused to pin it.
The +1 was `sumOf` returning `startsWith` - a *valid program answering a
different question*. All `function <name>` intents crystallize under a single
abstract signature (measured: `function VAR_0` is shared by 8 of 37 code
patterns), so the vault separates them only by spatial resonance and a
near-miss returns the wrong function. **That was always happening**; it was
harmless only because the emission was garbage the parse gate caught.
Parseability is not correctness, and fixing emission removed the accident that
had been concealing a retrieval defect. A name-consistency check
(`_answersTheQuestion`: slot 0 is the declared function's name, so an answer
whose name is absent from the question is not an answer to it) restored
confFalse to 4 - final: **7 GAIN / 0 BROKE / 0 LOSS**.

HumanEval is unchanged at 0.0% / 11 / 11 / 109 - the second half of the
prediction held, and for the reason already recorded: retrieval never fires
there at all, so there is nothing for an emission fix to improve.

Successor prediction, on the record: **the code family's binding constraint is
now retrieval keying - the intent signature abstracts away the function name
that identifies which pattern is wanted, so `function sumOf` and `function
startsWith` are the same key. Making the intent's content words part of the
retrieval key (rather than VAR-abstracted) takes the round-trip probe above
80% at confFalse 0, without touching emission or adding a reasoning
mechanism.** Wrong-if: keying on intent content leaves the probe below 80%, or
it clears 80% only by raising confident falsehoods above the pinned 4 (i.e.
sharper keys buy recall by trading away the covenant).

### Update, same day: retrieval keying fixed - the channel probe is 100%

**Graded: CONFIRMED, with one clause that needed an unnamed mechanism.** The
predicted change alone - keying code patterns by their literal intent
(`CODE:function sum of`, not `function VAR_0`) - took the probe **24.1% →
82.8%**, clearing the 80% bar without touching emission and without adding a
reasoning mechanism, exactly as stated. The wrong-if did not fire in either
branch.

But the main claim said "above 80% **at confFalse 0**", and keying alone landed
82.8% at confFalse **4**. Reaching zero needed a third change the prediction
did not name: **fast-path order.** Code synthesis ran as the LAST fast-path, so
any earlier mechanism that produced anything for a sink-terminated query won -
`function is Even |-` had `isEven` sitting in the vault under a correct exact
key and was answered `"even"` by semantic derivation instead. An exact key is
unambiguous by construction, so the exact branch is hoisted above vault recall
(Phase 0a); the fuzzy attractor-composition fallback stays where it was.

| round-trip (n=29) | pass@1 | abstain | confFalse |
| ----------------- | ------ | ------- | --------- |
| pre-gate | 0.0% | 58.6% | 12 |
| emission gate | 0.0% | 86.2% | 4 |
| emission fixed | 24.1% | 62.1% | 4 |
| + exact keying (the predicted change) | 82.8% | 3.4% | 4 |
| **+ Phase 0a hoist** | **100.0%** | **0.0%** | **0** |

Deduction is untouched (84.3% / 33.1% / confFalse 0, byte-identical, "No
regressions"), which the namespaced key makes structural rather than lucky: a
`CODE:` signature exists only for a crystallized code pattern, so a logic query
cannot mint one or match one.

**Three iterations, three times the binding constraint was somewhere other than
where the prediction put it** - emission (predicted: >80%, got 24.1%), then
keying (predicted the mechanism correctly, missed that ordering also mattered),
with the ordering defect invisible until the two upstream fixes stopped masking
it. The recurring shape is worth naming: each fix did not so much solve the
problem as *expose the next one*, because each upstream defect was destroying
the evidence that would have revealed its successor. Garbage emission concealed
wrong retrieval; wrong retrieval concealed wrong ordering.

**What this does NOT mean.** The probe is now saturated - 29/29, no silence, no
error - so it has stopped being a measurement and is only a regression guard.
It measures **recall of functions the engine was shown verbatim**, which is not
synthesis. HumanEval is unchanged at **0.0%** across all three configurations,
and that is the number that speaks to §3.5's actual claim. What has been
established is that the storage/retrieval/emission channel is now lossless
end-to-end; what has not been touched is generalizing to a function the engine
has never seen.

Successor prediction, on the record: **the remaining distance in §3.5 is
composition, not channel - with the round trip lossless, HumanEval pass@1 stays
at or near 0.0% until the engine can assemble a pattern it was never shown, and
no further work on storage, keying, or emission moves it.** Wrong-if: HumanEval
pass@1 rises materially above 0 from channel-level work alone (better keys,
better emission, more corpus), which would mean the channel was still the
constraint and this session's ceiling was self-imposed.

### Update, same day: the toolkit - first HumanEval passes, 0.0% → 2.5%

**Graded: FALSIFIED, and by a mechanism the prediction did not contain.**
HumanEval pass@1 moved to **2.5% (4/159) at confFalse 0**, and not one of the
four was assembled - each is a single stored primitive that turned out to solve
the problem. The prediction said the number could not move "until the engine
can assemble a pattern it was never shown". It moved without any assembly at
all.

The prediction's error was a false dichotomy. It offered *channel* versus
*composition* and the answer was neither: what was missing was **selection by
execution**. Every candidate was already in the vault and already emittable; no
mechanism was choosing among them against the request. Note the wrong-if is
also badly drawn - it names "better keys, better emission, more corpus" as the
channel-level moves, and the actual move is none of those.

**What was wired.** The code domain's asset is that its oracle is free. Until
now only the benchmark ever spent it, to score the engine; `Toolkit.ts` lets
the engine spend it on itself. The problem's own doctests become the goal -
**156 of 159 problems carry them, 443 in total**, and the doc-surface reader was
discarding them as noise - every stored pattern is a candidate, all are executed
against the goal, and only a candidate that passes is committed. The covenant's
characteristic failure is free by construction: what cannot be verified is
never emitted.

**The four passes are transfer, not recall**, which is the result worth
carrying:

| problem | solved by | why |
| ------- | --------- | --- |
| `strlen` | `count` | counts elements of an iterable; strings are iterable |
| `get_positive` | `filterPositive` | the same function under a different name |
| `max_element` | `largest` | same |
| `add` | `concat` | `a + b`, written for strings, is addition for numbers |

`concat` solving `add` and `count` solving `strlen` share no name, no intent
phrase, and no signature. They were found by **execution** - the one retrieval
channel indifferent to what anything is called. Set against this same session's
exact-intent keying, which works precisely when the request names the thing and
is useless here, the two are complementary retrieval modes rather than
competing ones.

**A specification floor.** The first run committed 6 and passed 4; both false
commitments came from problems carrying a SINGLE example. One example is not a
specification - it is one point, and any number of wrong functions pass through
a point. Requiring two costs reach on 30 of 159 problems and buys confFalse 0;
all four genuine passes had two or more. After it, self-verified equals
official-pass exactly, which is the property worth having: the toolkit is no
longer lying to itself.

**Ablation, stated so 2.5% is not over-read.** The doctests are parsed and
handed in. Turning prose into a specification is work the Language layer cannot
do (§3.1), so this isolates composition from reading exactly as the round-trip
probe isolated the channel from reading. And this is not search: it enumerates
what the vault holds. It was built to decide whether the next mechanism is
search or vocabulary, and it answers that - 49 patterns yielded 4 solutions, so
**the library, not the selection, is now the constraint.**

Successor prediction, on the record: **vocabulary is the binding constraint, and
it is the cheap kind - growing the Stage-1 corpus from 30 hand-written
primitives to a real stdlib (string/array/math coverage) takes HumanEval pass@1
into double digits at confFalse 0 with the toolkit unchanged, i.e. with no
search and no composition.** Wrong-if: a substantially larger primitive library
leaves pass@1 below 10%, which would mean single-primitive transfer is
exhausted near 4 and genuine composition is required for everything beyond it.

## 3. The gap inventory

Ordered by how much distance each item covers. Size classes: **mechanism**
(a new physics/traversal primitive, the expensive kind), **engineering**
(no new ideas), **corpus** (authoring/ingesting data).

### 3.1 The language front-end is the bottleneck - not the reasoning

The hop-score inversion is the tell: symbolic chains (hop 3-5) traverse at
1.00 while naturalistic hop-1 surface forms score 0.60. The reasoning engine
is not what loses to the LLM; the *reading* is. A flagship LLM's real moat on
deterministic tasks is universal ingestion - it parses any phrasing into its
implicit representation. ModPAT's Language layer covers a pattern-lexicon
sliver of English.

**Status (2026-07-21, measured):** the route-(a) first cut is built, guarded,
and committed (`TextGraph.ts` compromise-grammar parse → GroundGraph;
`TextGrounding.ts` anchored placement; `GraphQuery.ts` reading answers off
the asserted-only **directed** ledger; guards in `tests/text_graph.test.ts`).
Its soundness contract was iterated four times against the honest baseline,
each exclusion measured: directed ledger, hypothetical stamp on rule content,
pair-scoped stamp on reified SVO, polarity-loss guard (a naive undirected
ledger scores 54.8% balAcc but 19 confident falsehoods - rejected).
Paraphrase families: taxonomy hop-1 0.14→1.0, hop-3 0→1.0, negation 0→1.0;
implication 0.833→0.667 deliberately accepted (the higher number rode unsound
rule flattening). The §5 hop-1 clock started 2026-07-19. Still open: the
ledgers are in-memory only (not in snapshots/vault); rule-hop depth d1+
stays with the reasoning engine (§3.2).

Three routes (theorized):

- **(a) Grammar-grounded ingestion.** A dependency/constituency parse *is* a
  typed directed graph over terms - the unified IR already eats those. Route
  the parser output through GroundGraph instead of the pattern rules. This is
  the architecturally honest option: syntax becomes terrain like everything
  else.
- **(b) A small LM as boundary translator.** Use a compact model strictly as
  text→IR parser (and IR→text verbalizer). This does not compromise the
  thesis - the Language layer's charter is already "translation, not
  thinking" - but the parser's errors become un-addressable, so every parse
  must pass the coherence gate before crystallizing. Fastest route to surface
  robustness; hybrid, honest about it.
- **(c) Grow the pattern lexicon.** Dead end at scale; listed to be explicit.

Route (a) is the thesis-pure path, (b) is the pragmatic one; they compose
(b first for coverage, (a) replacing it region by region). Size: mechanism +
corpus; the single largest item, roughly half the remaining distance.

### 3.2 Quantifier / FOL breadth

Have (measured, wired as reduction fast-paths): universal instantiation,
negation-as-antipode, conjunction elimination/introduction, modus
ponens/tollens, disjunctive syllogism by rule discharge, hypothetical
syllogism. Missing: existentials, nested quantifiers, equality chains at
depth, proof by cases, the classical/closed-world negation distinction as an
explicit mode. The Phase 3 pattern (each connective = an edge kind + a
traversal fast-path + a guard test) is established and has been executed six
times; each missing connective is one more iteration. Size: several
mechanisms, individually medium. This is where flagships are weakest (FOLIO
70s-80s), so it is the most winnable ground.

**Status (2026-07-23, measured):** first iteration built and pinned -
copula-attribute AND relational (SVO) rules ("if something is rough and not
blue then it is not kind", "all nice, blue things are kind", "if someone
chases the cat then they like the dog") are extracted as structured
condition/conclusion records at parse time (`TextGraph`), precept-resolved
into `system.textGroundedRules` (`TextGrounding`), and discharged by
GraphQuery in a transient per-query fixpoint closure - open-world semantics
(negated conditions demand explicit contrast support; conjunctions fire only
on full match; derived-vs-asserted conflict poisons to silence; reflexive
derivation via variable unification is SOUND and intentionally allowed -
confirmed against gold labels, see data/benchmarks/README.md; asking never
creates). Guarded in `tests/rule_discharge.test.ts` (18 cases). Honest
external: 44.3%→83.8% balAcc, confFalse 4→0 (§2 second update). Still
missing here: relations beyond simple SVO (prepositional, multi-clause), the
closed-world negation-as-failure mode (stage 2, built but not enabled),
existentials, nested quantifiers, proof by cases.

**Stage 2 status (2026-07-30, measured):** CWA is re-measured on the fixed
tree at **96.7% balAcc / 16.3% abstention / confFalse 1** (from 83.8 / 33.8
/ 0), i.e. 27 items of silence converted to correct answers against a single
break. The previously-recorded "confFalse 5→16" is refuted as evidence about
CWA - it was measured through the reflexive-derivation guard and the ungated
perception path, both fixed at `87fca2a` (§2 third update). It remains OFF
by default: one confident falsehood fails the covenant's red line. The
blocker is now identified and narrow - closure incompleteness converting
into denial, where OWA would have converted it into silence - so the next
move is a completeness-aware denial gate, not more rule soundness.

### 3.3 Disjunction physics (prediction 2, OPEN)

OR-as-median (partial constructive interference below the commitment
threshold) still lacks its mechanism; disj1 lives in the wrong-but-coherent
bucket by design. The symbolic rule-discharge path covers the syllogism form
but not the physics form, and the prediction stays untestable until the
resonance path is revived (2/5 deps missing, `attic_status`). Size: one hard
mechanism; blocks a slice of ProofWriter-class cases.

### 3.4 Arithmetic beyond the additive homomorphism

posW composition IS addition (exact, error structurally inexpressible).
Multiplication is additive in log-coordinates - a second exact homomorphism
is available for the taking (theorized): a log-scale coordinate channel, same
constructor-inherited guarantee class. Large numbers need positional
structure - digits as containment trees, which the unified IR already
represents. Size: one mechanism (log channel) + engineering (positional
encoding). Word problems then reduce to 3.1 (reading) + this.

### 3.5 Code synthesis depth

`Synthesizer` collapses geodesic paths to TypeScript. The asset: code is the
domain where the survey loop is cheapest (tsx execution = free territory
contact), so wrong synthesis is caught and repaired locally by machinery that
already exists. Size: large engineering + corpus, derisked by the loop.

**The 1.0 this section used to cite was the wrong number.** "Behavioural
fidelity 1.0 on the 132-case corpus" is `CodeBehaviouralFidelity.ts`, which
checks `a + b` / `a - b` reduction against tsx. It is a real result about
arithmetic and says nothing about emitting a function.

**Status (2026-08-01, measured):** the honest baseline is run - all 159
MultiPL-E TypeScript HumanEval problems, candidates executed against the
official tests. **pass@1 0.0% in every configuration**, and no emission was a
program at all (§2's 2026-08-01 update has the table and the three findings).
The residual is NOT "synthesizing control flow and data-structure
manipulation" as this section claimed from 2026-07-05 to 2026-08-01: retrieved
templates already carry correct `if`/`for` structure. It is that **code cannot
survive the round trip through its own storage medium** - operators return in
word form, punctuation is space-joined, identifiers return unbound - measured
at 0% on 29 functions the engine had just been shown.

**The channel is now lossless end-to-end (2026-08-01, measured).** Three
iterations in one session took the round-trip probe **0% → 100%** (29/29, zero
abstention, zero confident falsehoods): an emission gate (covenant, not
capability), then the detokenizer plus persisted slot names (0 → 24.1%), then
exact intent keying plus a fast-path reorder (24.1 → 100%). Full history and
per-iteration numbers in §2's 2026-08-01 updates.

**That probe is now saturated, and it measures recall, not synthesis** - these
are functions the engine was shown verbatim. **HumanEval remains 0.0%** in
every configuration, and it is the number that speaks to this section's claim.
What is established: storage, retrieval, and emission no longer lose anything.
What is untouched: assembling a function the engine has never seen. The
residual here is composition, and it is the whole of the remaining distance.

### 3.6 Scale

Deterministic-task parity does NOT need web scale - a ProofWriter episode is
~20 facts; the working set for the whole curriculum below is maybe 10^5-10^6
precepts, which is exactly the current `MAX_PRECEPTS`. Needs: cap lift,
grid-index throughput at that population, vault growth. Size: engineering
only. (The DOD layout was built for this; it is the part of the thesis that
is least in doubt.)

### 3.7 Degree/magnitude placement (already ROADMAP P7 prereq)

Comparatives and quantities ("at least three", "much larger") are graded
structure; the radial-intensity primitive is specified in ROADMAP with its
gate probe (hungry/starving/full/sated) still unrun. Needed for word-problem
surface forms. Size: one mechanism, gated by a cheap probe.

### 3.8 Expression (proof verbalization)

The vault already stores derivation paths - proofs with addresses. Parity
output for deduction benchmarks includes the *explanation*, and verbalizing a
stored path is translation-boundary work (the inverse of 3.1, sharing its
machinery). Size: engineering once 3.1 exists.

## 4. What does NOT need building

The architecture's freebies on this terrain, each already measured:

- **Calibrated abstention** - the gate's 100% balanced accuracy is a property
  flagships still lack (they answer everything). On any benchmark scored with
  a wrong-answer penalty, this is an immediate structural edge.
- **Continual learning by locality** - no catastrophic forgetting by
  construction (prediction 3, unrun; the benchmark below runs it).
- **Auditability** - every error has an address; benchmark failures are
  terrain defects you can point at, not weights you can only fine-tune.
- **Inference cost** - traversal is ms-scale cache-coherent array work per
  query on CPU; no forward pass.

## 5. Effort estimate (redone 2026-07-23, partially measured)

### Grading the 2026-07-05 estimate

The original shares (language front-end ~45%, FOL breadth ~20%, code
synthesis ~15%, arithmetic ~8%, scale ~7%, expression ~5%) and milestones
were pure theory - written before the honest baseline existed. They can now
be graded against what actually happened:

- **Honest external baseline**: estimated days. **DONE 2026-07-21, on time.**
- **Wrong-if criterion** ("if the naturalistic hop-1 family does not clear
  0.9 within one quarter of starting 3.1, the front-end estimate is wrong"):
  **CONFIRMED, and beaten.** The route-(a) clock started 2026-07-19;
  taxonomy hop-1 cleared 0.14→1.0 within **4 days**, not the one-quarter
  (three-month) bar. The estimate wasn't just right, it was conservative.
- **"Logic-family parity" bullet** (3.2 + 3.3 + a first cut of 3.1 **via
  route (b)**, estimated months, single-digit): **partially confirmed,
  ahead of pace, via a different route than predicted.** First cuts of 3.1
  AND 3.2 landed in the same 4-day window, not months - but via route (a)
  (grammar-grounded ingestion), not the anticipated route (b) (small-LM
  boundary translator) the estimate was hedged on. This resolves an open
  uncertainty from §3.1: route (a) was expected to be the slow, thesis-pure
  path with (b) needed as a stopgap for surface robustness; it turned out
  fast enough to be the primary path directly, with no stopgap needed for
  the SVO/attribute slice. **3.3 (disjunction physics) remains fully open**,
  so the bullet as originally scoped is not yet closed.
- **"Full route-(a) language grounding: open-ended research"**: also
  resolved faster than hedged - the SVO/attribute-rule slice is done, not
  open-ended. What remains open-ended is deeper syntactic generality
  (arbitrary nested clauses, prepositional relations) - a narrower claim
  than the original.
- **Arithmetic + word-problem parity, Code (HumanEval-class)**: unstarted,
  ungraded - see below, these are now the shares that matter most.

### Updated shares (still theorized; renormalized to the distance remaining today)

The deduction family (RuleTaker/ProofWriter-class - §3.1 + §3.2 + §3.3) is
no longer theorized: it is measured at **83.8% balanced accuracy, 0
confident falsehoods**, with the entire residual being abstention (33.8%),
not error. That family's remaining distance is now small and mostly
engineering (relations beyond SVO, existentials, nested quantifiers, proof
by cases) plus one still-open mechanism (CWA negation-as-failure, attempted
once and reverted - see §2). Every OTHER benchmark family named in §1
(FOLIO's nested-quantifier-heavy FOL, arithmetic word problems,
HumanEval-class code) is exactly as untouched as it was on 2026-07-05 - so
its SHARE of what's left necessarily grew, not because it got harder, but
because the biggest original item shrank:

| item | share of distance remaining | status |
| ---- | ---------------------------- | ------ |
| 3.1 residual (prepositional/multi-clause reading, vault persistence) | 10% | first cut DONE; residual is engineering |
| 3.2 residual (existentials, nested quantifiers, proof by cases, CWA reinstatement) | 15% | first cut DONE; CWA attempted once, reverted (§2) |
| 3.3 disjunction physics | 10% | untouched; one hard mechanism (prediction 2, OPEN since 2026-06-11) |
| 3.4 arithmetic beyond addition | 10% | untouched |
| 3.5 code synthesis depth (HumanEval-class) | **35%** | baseline RUN 2026-08-01: HumanEval pass@1 **0.0%**. Channel (storage/retrieval/emission) fixed the same day, probe 0 → **100%**; residual is composition - synthesizing a function never seen (§2) |
| 3.6 scale | 5% | untouched; engineering only, low risk |
| 3.7 degree/magnitude placement | 5% | untouched; gate probe unrun |
| 3.8 expression (proof verbalization) | 10% | untouched; depends on 3.1 |

**Code synthesis is now the long pole**, exactly as the 2026-07-05 estimate
predicted it would eventually become ("the long pole after language; ~a
year") - that framing is confirmed sooner than expected, precisely because
language moved faster than budgeted.

### Updated milestones

- **Deduction-family parity** (close the residual §3.1/§3.2 gaps +
  disjunction physics): the measured 83.8%/0-confFalse baseline plus the
  Phase-3 pattern's six prior executions suggest weeks, not months, for the
  engineering residual (3.1/3.2); disjunction physics (3.3) is the
  uncertain one - it has been open since 2026-06-11 without a mechanism,
  so it should NOT be assumed to fall on the same fast cadence.
- **Arithmetic + word-problem parity**: 3.1's first cut is done, so this
  clock has effectively started; +2-3 months from here is unchanged and
  ungraded (no work has begun).
- **Code (HumanEval-class)**: unchanged, ~a year, now explicitly the
  largest single remaining item rather than one competing with language.

On the record, a fresh gradable prediction for the next iteration: **if
closed-world negation-as-failure cannot be reinstated in the harness
without regressing confFalse above 0 within a comparable few-day iteration
cycle to the OWA relational discharge (this session), CWA is a harder
mechanism than the stage-1 pattern suggests and should be scoped as its own
multi-iteration effort, not a flag-flip.** Wrong-if: a CWA re-attempt lands
confFalse-0 within roughly the same cadence as this session's OWA work.

**Graded 2026-07-30: NOT falsified, but only just, and its premise was
wrong.** The wrong-if did not fire - the re-attempt landed confFalse **1**,
not 0, so on its literal terms the prediction stands and CWA is not a
flag-flip. But it should be recorded that the prediction was made on
evidence (confFalse 5→16) that has since been shown to be an artifact of two
unrelated defects (§2 third update), and the honest re-measurement is
+12.9pp balanced accuracy at a single break with 27 gains and zero losses.
"Harder than a flag-flip" is confirmed; "a multi-iteration effort" is not -
the failure is one diagnosable class (closure incompleteness surfacing as
denial), not a mechanism in doubt. The next prediction should be scoped to
that class, not to CWA as a whole.

Successor prediction, on the record: **the deduction family closes to ≥95%
balanced accuracy at confFalse 0 by making CWA denial completeness-aware -
denying only when the closure reached fixpoint with no unresolved negative
dependency for the queried subject - rather than by further soundness work
on the rules themselves.** Wrong-if: a completeness-aware denial gate either
fails to recover confFalse to 0, or recovers it only by abstaining back
below ~90% balanced accuracy (i.e. the gate cannot separate "underivable"
from "not yet derived", and the two are genuinely entangled at this depth).

**Graded 2026-07-30, same session: CONFIRMED in outcome, WRONG in
mechanism - a half hit, and the mechanism half is the instructive one.**
The outcome bar was cleared exactly as stated: 96.7% balanced accuracy at
confFalse 0, and it came from a denial-side gate rather than from more rule
soundness. But the stated MECHANISM was wrong in both of its parts. The
closure had already reached fixpoint with no unresolved negative dependency
- that signal would have fired on nothing - and the real trigger was entity
aliasing, a front-end defect (§3.1 territory) surfacing as a reasoning
failure. A second, independent fix (the `pairScoped` stamp) was also
required and was not anticipated at all.

The lesson worth carrying: the prediction was framed entirely inside the
reasoning engine, and the actual causes were both at the ingestion boundary.
That is the same inversion §3.1 opened this document with - "the reasoning
engine is not what loses; the reading is" - reappearing one layer down,
where a reading defect had been masquerading as a closure-completeness
question. A confirmed outcome reached through a wrong mechanism is not
evidence the model of the system was right, and should not be counted as
one.

## 6. Training curriculum (theorized)

ModPAT does not train by gradient descent. "Training" is three operations:
**carving** (structure-grounded ingestion writes terrain), **surveying**
(behavioural fidelity channels let the territory correct the map), and
**crystallizing** (proven derivations cached in the vault). A curriculum is
therefore a *corpus ordering with fidelity gates*, not an epoch schedule -
closer to teaching than to pretraining. Ordering is safe (locality of writes
⇒ no need to shuffle) and each fact is ingested once, locally.

### Stage 0 - Gauge fixing

Operator attractors, the number line, foundational/eternal precepts, the
capability wells. These fix the gauge every later placement is relative to.
**Gate:** exact-domain behavioural fidelity 1.000 (already held).

### Stage 1 - Exact homomorphisms first

Number-line arithmetic (extend past the seeded 0-99), a small code stdlib as
AST graphs, toy closed-world KBs. Rationale: where the embedding is exact,
error is structurally inexpressible, so early terrain is trustworthy
scaffolding - and the survey loop maintains it for free (self-channel =
"free exact-domain maintenance", measured in the influence bench).
**Gate:** behavioural fidelity 1.000 sustained; seeded mis-survey repaired
with locality (already demonstrated per-channel; here sustained at scale).

### Stage 2 - Relational breadth

Typed-graph corpora: taxonomies, WordNet hypernymy/meronymy, the antonym
lexicon's radial sibling (intensity scales - this stage *is* the
degree-placement primitive's data source). Approximate-embedding territory
begins here; errors become misunderstandings with addresses.
**Gate:** per-corpus mapFidelity pearson ≥ 0.94 and separation ≥ 2 vs null
(the Phase 1 bar), closed-world fidelity trending up from 0.844.

### Stage 3 - The benchmark curriculum proper

The key move, aimed at the 3.1 bottleneck: **paraphrase families over fixed
terrain.** Take one fact-set; ingest it once; then present N surface
variants of the same queries. The map is the invariant, only the reading
varies - so every failure is attributable to the front-end, never the
terrain, and each repaired parse is a reusable translation gain. Sequence:
hop-1 paraphrase families → increasing hop depth → quantifier nesting →
disjunctive/case-split forms (once 3.3 lands).
**Gate:** balanced accuracy with abstention scored separately, pinned per
family in the baseline JSON (the regression surface already exists); the
characteristic failure must remain silence, never confident falsehood.

### Stage 4 - Cross-domain transfer

Word problems (language + arithmetic), spec-to-code (language + code),
scene queries (language + geometry). This stage is the *test of the unified
IR bet*: if code = logic = math as typed graphs, transfer is free and only
the reading is new. If a domain pair needs new mechanism here, the thesis
overclaimed and this document must record it.
**Gate:** cross-corpus sweep at the Phase 4 bar (pearson ≥ 0.98, onPath
≥ 0.95) on mixed corpora.

### Stage 5 - Adversarial and continual

Interleave new corpora with retention probes over everything prior - this IS
prediction 3's benchmark (vs a fine-tuned transformer baseline), run as
curriculum rather than as a one-off. Plus seeded corruption at scale: random
terrain defects must be localized and repaired by the survey loop while the
rest of the curriculum proceeds.
**Gate:** no material retention degradation with manifold growth (prediction
3's wrong-if criterion, finally exercised).

### Stage 6 - Self-directed tail (P7)

Telegenesis picks the next corpus by info-gain: *where is the map thin or
high-curvature = least faithful = the gate abstains most*. Abstention
frequency per region becomes the curriculum signal, and the learner chooses
its own syllabus through the InquiryQueue. The curriculum's end state is
that nobody writes Stage 7.

### Curriculum principles (contrasts with LLM pretraining)

1. **Order is information.** Exact before approximate, structure before
   surface. Safe because writes are local - no shuffling, no replay buffers.
2. **Quality beats quantity.** A wrong fact is a terrain defect with an
   address; the survey loop catches it only where the domain is checkable.
   So checkable corpora can be ingested greedily; authored relational
   corpora need curation (KB channel = "authored relational coverage").
3. **Abstention is the teacher's signal.** Where the gate goes silent, the
   map is thin; that is the next lesson, mechanically.
4. **One pass.** No epochs. A fact ingested is placed; re-presentation is
   only useful as a paraphrase family (Stage 3) or a survey probe.

## 7. The one-sentence answer

Parity on deterministic *reasoning* is near - the mechanisms mostly exist
and measure 0.83-1.00 on the families they cover; parity on deterministic
*tasks as people pose them* is now mostly three named mechanisms
(disjunction physics, multiplicative/positional arithmetic, degree
placement) plus closed-world negation-as-failure, an honest external-
dataset baseline (run 2026-07-21, iterated 2026-07-23: **83.8% balanced
accuracy at ZERO confident falsehoods** across 160 real RuleTaker/
ProofWriter items - the distance is now a number, and a small one), and a
staged curriculum whose gates this repo has, unusually, already built and
measured.
