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
| behavioural fidelity (arith / code) | 1.000 / 1.000 |
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

`Synthesizer` collapses geodesic paths to TypeScript; behavioural fidelity is
1.0 on the 132-case corpus. HumanEval-class parity means synthesizing
control flow and data-structure manipulation, not path collapse. The asset:
code is the domain where the survey loop is cheapest (tsx execution = free
territory contact), so wrong synthesis is caught and repaired locally by
machinery that already exists. Size: large engineering + corpus, derisked by
the loop.

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
| 3.5 code synthesis depth (HumanEval-class) | **35%** | untouched - now the single largest remaining item |
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
