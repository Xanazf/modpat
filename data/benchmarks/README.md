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

## 2026-07-30 (later still) - aliasing FIXED at the source

The gate above made aliasing safe; this makes it not happen. Both parsers
already share one `ensure` (TextGraph's `DedupGraphBuilder extends`
LogicGraph's `GraphBuilder`), so the divergence was purely in what string
each passed in. **`GraphBuilder.ensure` now reduces a multi-word Term label
to its head** (`npHead`, LogicGraph.ts), which is the convention the
grammatical pass already used via `collectNpGroups`. One entity, one label,
enforced at the single point both parsers meet - they cannot drift apart
again.

Chosen over the alternative of narrowing LogicGraph delegation, because the
"subsumes LogicGraph on every sweep corpus" guard compares
`buildGraphFromText` against `buildGraphFromLogic` BY LABEL: removing
delegation would let the two label sets diverge and break it, while changing
`ensure` moves both sides identically. The sweep corpora are all single-word
entities, so the reduction is a no-op there.

Two refinements the guards forced, both worth keeping:

- **Coordinated spans are exempt.** Delegation hands `ensure` the whole
  subject span of "cats or dogs are pets"; reducing it to `dog` collided with
  the node the grammatical pass distributes to, and dedup then swallowed that
  disjunct's softened w0.5 edge. Only a SIMPLE noun phrase has one head, so
  spans containing a coordinator or preposition are left alone.
- **The simple-NP test runs on the RAW span**, not the lemmatised one:
  `lemma()` filters through compromise's `.nouns()`, which drops the
  coordinator, so "cats or dogs" arrives already looking simple.

Measured, honest mode, 160 items:

| configuration | balAcc | abstain | confFalse |
| ------------- | ------ | ------- | --------- |
| OWA before | 83.8% | 33.8% | 0 |
| **OWA after (new pin)** | **84.3%** | 33.1% | 0 |
| CWA + gate (previous) | 96.7% | 16.9% | 0 |
| **CWA after** | **97.6%** | 15.6% | 0 |

ruletaker d3 AND d5 now 100%; d0/d1/d2 95%. Against the OWA pin the full
per-item picture is **29 GAIN, 0 BROKE, 0 LOSS, 0 CHURN**.

**Sizing correction, on the record:** 23/160 items (14%) contain a multi-word
entity, and that figure was offered as an upper bound on what the fix might
recover. It recovered **2**. The split only mattered where a derivation had
to cross both halves; everywhere else the sparse half was never consulted.
The 14% was a measure of exposure, not of harm, and should not be cited as
the fix's value.

**The `entityAliased` gate was removed, not kept as a safety net.** With
single-word Term labels it can never fire, so it was unreachable code whose
guard test could not be written honestly. Per the repo's own rule - a
superseded path with no capability delta is deleted, not archived - it is
gone, and the CWA denial branch in GraphQuery now documents that its
soundness rests on the normalisation instead.

**Separate defect found and NOT fixed here:** `questionToProposition`
mis-canonicalizes aux-fronted questions with a multi-word subject - "is the
bald eagle red?" becomes "the bald is eagle red", because its
subject/predicate split is non-greedy and stops at the first word. Do-support
escapes it (it drops the auxiliary rather than re-seating it), and the
deduction corpora ask declaratively, so nothing here is affected. Fixing it
needs real NP parsing, not a greedier regex: greedy would break
"is felix a mammal". Pinned as a note in `tests/rule_discharge.test.ts` so it
cannot later be mistaken for an aliasing regression. **(Fixed 2026-07-31 -
see below.)**

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

---

## 2026-07-31 - `questionToProposition` split, and a measurement that moved nothing

The aux-fronting defect flagged above is fixed: the subject/predicate split
now reads compromise's POS tags instead of counting words. Recorded here
because the *measurement* is the point.

**Nothing moved, and that was the prediction.** Before starting, all 160 items
were checked for aux-fronted question surfaces: **0 of 160**. RuleTaker and
ProofWriter both phrase questions as declaratives ("Anne is nice."). Both
configurations re-measured after the fix:

| configuration | balAcc | abstain | confFalse |
|---|---|---|---|
| OWA | 84.3% | 33.1% | 0 |
| CWA | 97.6% | 15.6% | 0 |

Byte-identical to the pin - the re-run changed only the baseline file's
timestamp, which was reverted rather than committed. This is a
live-conversational-path fix that the external benchmark is structurally
incapable of scoring, in either direction. It could not have caught the defect
and cannot confirm the fix; the guard tests do that, sweeping every question
surface in `tests/`.

**Worth keeping in view:** a benchmark that cannot see a defect is not
evidence the defect is absent. The 0/160 was measured, not assumed, and it is
the reason this work was scoped as a correctness fix rather than sold as a
score improvement.

Verification actually used:

```bash
# every question surface in the test corpus, swept for corruption
yarn test          # canonicalization guard in tests/text_graph.test.ts
                   # + aux-fronted multi-word subject in tests/rule_discharge.test.ts
# and the null result above:
tsx tests/benchmarks/external_benchmarks.ts --datasets data/benchmarks --no-pin
tsx tests/benchmarks/external_benchmarks.ts --datasets data/benchmarks --cwa
```

Two tagger failures found by sweeping surfaces rather than by reasoning, both
now guarded: mid-string articles mis-tag (`"felix an animal"` tags `an` as a
Noun), so articles are matched by surface; and a subject can itself mis-tag
(`"bob rich"` tags `bob` an imperative Verb), so position is the fallback.

## HumanEval-TS - the code-synthesis family (PARITY §3.5)

`humaneval_ts.jsonl` is the **complete** MultiPL-E TypeScript translation of
HumanEval (159 problems), vendored rather than sampled - it is small, and
"the actual dataset files through the pipeline" is the whole point of it.

| file | source dataset | license |
| ---- | -------------- | ------- |
| `humaneval_ts.jsonl` | MultiPL-E `humaneval-ts` (Cassano et al., "MultiPL-E: A Scalable and Polyglot Approach to Benchmarking Neural Code Generation", TSE 2023), translating HumanEval (Chen et al., "Evaluating Large Language Models Trained on Code", 2021) | MIT |

Schema (one JSON object per line):

```json
{ "id": "HumanEval_0_has_close_elements", "entryPoint": "has_close_elements",
  "prompt": "//Check if ...\nfunction has_close_elements(...): boolean {\n",
  "tests": "declare var require: any; ... test();", "stopTokens": ["\nfunction ", ...] }
```

Regenerate with `tsx scripts/dev/fetch_code_benchmark.ts` (downloads the
parquet from HuggingFace, reads it through DuckDB - already a dependency - and
sorts by HumanEval index, so re-runs are byte-identical).

**Why TypeScript rather than the original Python.** §3.5 names the code
domain's asset as "tsx execution = free territory contact": ground truth comes
from RUNNING the candidate in a child process that never sees a manifold
coordinate, the same non-circularity argument `CodeBehaviouralFidelity.ts`
makes for arithmetic. That argument only holds in a language this repo can
execute, and the Synthesizer emits TypeScript.

### Scoring

`tests/benchmarks/code_benchmark.ts`, covenant-shaped rather than pass@1 alone:
every item is `abstain` (no commitment), `pass` (official tests green), `fail`
(committed, parses, tests red), `invalid` (committed, does not parse), or
`timeout`. `confidentFalsehoods` = every committed item that is not `pass`.
Counting `invalid` there is deliberate - an emission that does not parse is
still a commitment, and calling it abstention would flatter the metric by
reclassifying garbage as silence.

### 2026-08-01 - the honest baseline

Three configurations over all 159 problems, per-item checkpoints in
`code.checkpoint.jsonl`. `name` asks with the phrase ingestion itself would
mint (`has_close_elements` → "function has close elements") - the most
generous reading possible, isolating synthesis from reading; `doc` asks with
the problem's prose, which is what the task actually poses.

| configuration | pass@1 | abstain | confFalse | pass / fail / invalid / abstain |
| ------------- | ------ | ------- | --------- | ------------------------------- |
| cold vault, name surface | **0.0%** | 93.1% | 11 | 0 / 7 / 4 / 148 |
| stdlib-primed, name surface | **0.0%** | 93.1% | 11 | 0 / 7 / 4 / 148 |
| stdlib-primed, doc surface | **0.0%** | 31.4% | 109 | 0 / 4 / 105 / 50 |

Three findings, each stronger than the headline zero:

1. **Not one emission was a program.** Across all 477 item-runs there is no
   `pass`, and inspecting the commitments shows none of them is code at all.
   The `fail` bucket is bare English words - `is_prime` → `"prime"`,
   `is_palindrome` → `"palindrome"` - which parse only because a lone
   identifier is a valid expression statement and then throw `ReferenceError`
   at runtime. The `invalid` bucket is English prose
   (`"two numbers closer to each other than given threshold"`). So the honest
   statement is not "0% pass@1" but **the code path does not currently emit
   code for HumanEval-class input**.
2. **The Stage-1 corpus is inert.** Cold and primed are not merely equal in
   aggregate - they are identical on all 159 items *and byte-identical in every
   emitted string* (0 disagreements, measured). Ingesting 90 code patterns
   changes nothing about what a HumanEval query returns, because retrieval
   never reaches them: `checkInterferencePattern` keys on an abstracted
   signature plus a grid window around the query centroid, and an unseen intent
   phrase lands outside the window. This is why priming is not the lever.
3. **The doc surface is where the covenant breaks**, at 109 confident
   falsehoods against the name surface's 11. A prose query misses the vault,
   falls through Phase 0.5 into general settling, and gets answered with
   English - which the benchmark then scores as a failed commitment to code.

**A methodological caveat that must travel with finding 3.** The engine has no
way to know it was asked for code: `|-` is the GENERAL inference sink (the
entire deduction suite ends its queries with it), so a code request that misses
the vault is silently handled as a deduction request, and answering it in
English is the settling path doing exactly its job. Scoring that as a confident
falsehood charges the engine for the harness's framing. It is kept in the
confFalse column because under a synthesis task's contract a non-program answer
IS a failed commitment - but the absence of a request type is the underlying
defect, and it belongs to §3.5, not to the settling path.

### 2026-08-01 - the code-channel emission gate

The round-trip probe (`--roundtrip`: ingest the Stage-1 corpus, ask each
function back by the phrase ingestion minted for it, execute the result against
the original) isolates the storage/emission channel from reading entirely.
Pre-gate it measured **0% pass with 12 confident falsehoods on 29 functions the
engine had literally just been shown**, and the failure was one mechanism:

- Operators come back in word form - `+`→`plus`, `-`→`minus`, `*`→`times`,
  `=`→`equals` - because `BaseAtomizer` canonicalizes symbol and word forms to
  one scope so `"1 + 1"` and `"1 plus 1"` are the same sequence. That is
  correct for arithmetic language and destructive for source text.
- `decodeSequence` joins tokens with spaces, so punctuation is separated and
  commas are gone: `function f ( _ _ ) { return _ plus _ ; }`.
- Every identifier is `_`: an intent-only query carries no concrete tokens, so
  `buildBindings` binds nothing.

None of that is recoverable at read time, so the emission cannot be honoured -
and under the covenant the characteristic failure must be silence. The gate
(`_emissionIsProgram` in `Perception.ts`) parses the instantiated template and
refuses to commit what does not parse:

| round-trip (n=29) | pass@1 | abstain | confFalse | pass / fail / invalid / abstain |
| ----------------- | ------ | ------- | --------- | ------------------------------- |
| pre-gate | 0.0% | 58.6% | 12 | 0 / 4 / 8 / 17 |
| **gated** | 0.0% | 86.2% | **4** | 0 / 4 / **0** / 25 |

**It buys the covenant, not capability** - pass@1 is 0.0% either way, and it is
worth being explicit that the gate makes the engine emit *less*, not better.
The 4 surviving failures are the bare-word settling answers, which do not come
through the code channel at all.

**Scope, load-bearing:** the gate applies only to retrievals with non-zero
`slotFlags`, i.e. records `processCode` crystallized as CODE patterns. Phase
0.5 fires for every Sink-terminated query, so an ungated version would silence
any English vault recall arriving there (`"socrates is mortal"` does not parse
as JavaScript) - the same regression this file already records from the
perception-gate scoping work, which is why the discriminator is applied rather
than rediscovered.

**The gate is a measured no-op on HumanEval**, and that confirms the diagnosis
rather than disappointing it: re-running all three configurations gated gives
11 / 11 / 109 confident falsehoods, identical to pre-gate. Nothing changes
because nothing retrieves - the HumanEval commitments never come through the
code channel at all, they come from the settling path (finding 2 above). The
gate closes the code channel's own covenant breach; the settling-path leak is
a separate defect with a separate cause.

Two independent regression checks were run against the gated tree:

- **Deduction is untouched**: `external_benchmarks --datasets --no-pin`
  reproduces the pin exactly - overall 84.3% / 33.1% / confFalse 0, every
  family byte-identical, "No regressions vs externalReal baseline". This is
  the check that mattered most, since Phase 0.5 fires for every
  Sink-terminated query and the whole deduction suite ends its queries with
  `|-`.
- **Full suite green** (`yarn test`), with one pre-existing, unrelated failure
  excluded: `unfolder` asserts that Wikipedia expansion adds precepts and
  fails identically on the pre-change tree (verified by stashing the change
  and re-running) - it is network-dependent, not a regression from this work.

### 2026-08-01 (same day) - the emission fix: 0% -> 24.1% on the channel probe

The gate above bought silence; this is the capability. Three losses were
inverted, and the third turned out to be a bug rather than a limit.

**1. Operator words.** `detokenizeCode` (`Coder.ts`) inverts `BaseAtomizer`'s
`ARITHMETIC_CANONICAL` map (`plus`→`+`, `minus`→`-`, `times`→`*`,
`divided`→`/`, `equals`→`=`). Unambiguous *in an abstracted pattern
specifically*, which is the only place it runs: every identifier is already a
`VAR_N` slot, so a surviving bare word is a keyword or an operator, never a
variable that happened to be called `plus`. `===` is one token and passes
through untouched.

**2. Spacing needs no repair at all.** `decodeSequence` space-joins, giving
`function var_0 ( var_1 , var_2 ) { ... }` - which is *already valid
JavaScript*, because JS is whitespace-insensitive. Parsing and re-printing
through `generate` returns canonical source for free. The 2026-08-01 baseline
entry above lists "punctuation is space-joined" among the losses; that was
wrong, and only the operator and case losses were real.

**3. Case, and the names that were being thrown away.** The atomizer
lowercases, so `toUpperCase` decodes as `touppercase` and cannot be
mechanically restored. But `extractPatternFromNode` has always computed
`varNames` - the original identifier for every slot - and `processCode`
discarded them. They are now persisted (`var_names` column on `wave_forms`,
idempotent migration, JSON array index-aligned to slot number) and used as the
**base** bindings at emission, with query tokens demoted to a fallback.

That precedence flip is the "real slot bindings" half. The old order bound the
*query's own words* positionally, which is why asking for `filterPositive`
emitted `function filter ( positive ) { ... }`: the words of the question were
being installed as the function's identifiers. An intent phrase names the thing
being asked for; it does not name that thing's parameters.

**A genuine encoding bug, found by the fix.** `target_pattern` joins its tokens
with "," and retrieval splits on "," - so a token that IS a comma is destroyed
by its own delimiter, and `function f(a, b)` came back as
`function var_0 ( var_1 var_2 )`, which no longer parses. That cost nothing
while the vault held only English derivations. A literal comma is now escaped
to `<COMMA>`; escaping rather than changing the delimiter keeps old rows
readable, since no pre-existing row can contain the sentinel.

**The fix has to travel past the round trip, not through it.** The first
working version measured *worse* than it should have, because
`_resolveCodeSynthesis` returns ids and the caller re-decoded them - re-applying
every loss the detokenizer had just undone. `ObserveResult`/`CoherentResult`
now carry an optional `text`, the exact emitted surface, and the Traveler
prefers it over decoding. Absent for every other provenance, where ids remain
the single source of truth.

| round-trip (n=29) | pass@1 | abstain | confFalse | pass / fail / invalid / abstain |
| ----------------- | ------ | ------- | --------- | ------------------------------- |
| pre-gate | 0.0% | 58.6% | 12 | 0 / 4 / 8 / 17 |
| gated | 0.0% | 86.2% | 4 | 0 / 4 / 0 / 25 |
| **emission fixed** | **24.1%** | 62.1% | **4** | **7** / 4 / 0 / 18 |

Emitted code is now correct, formatted TypeScript - e.g. `filterPositive`
returns verbatim-equivalent source including the member name `push`, which
survives only because slot names carry it.

### The break this exposed, and why it is the interesting part

The first fixed run measured confFalse **5**, and the repo's own regression
guard refused to pin it ("the characteristic failure must remain silence").
The +1 was `sumOf` returning `startsWith` - **a valid program that answers a
different question.**

The cause is retrieval, not emission: all `function <name>` intents crystallize
under ONE abstract signature - measured, `function VAR_0` is shared by 8 of the
37 code patterns - so the vault discriminates them only by spatial resonance of
the query centroid, and a near-miss returns the wrong function. That has always
happened. It was harmless only because the emission was garbage the parse gate
caught. **Parseability is not correctness**, and fixing emission removed the
accident that had been concealing a retrieval defect.

The narrow fix is a consistency check that the emission itself makes available:
slot 0 of a code pattern is the declared function's name, so a retrieval whose
name does not appear in the question is not an answer to it
(`_answersTheQuestion`). Matching squashes to alphanumerics because the intent
surface is `deriveIntent`'s camelCase split ("function sum Of") while the
stored name is the identifier ("sumOf"). One subtlety worth recording: it
matches against the WHOLE query rather than its content tokens, because a
function can be named after an operator word - `function equals` has its own
name canonicalized to the `=` operator and filtered out of the content tokens,
and the first version silently cost that item a pass.

Result: 7 GAIN / 0 BROKE / 0 LOSS against the gated pin, confFalse unmoved at 4.
The 4 survivors are the bare-word settling answers (`isEven` → `"even"`), which
never come through the code channel.

### 2026-08-01 (same day) - retrieval keying: 24.1% -> 100% on the channel probe

The emission fix moved the constraint to retrieval, and the diagnosis was
specific: all `function <name>` intents crystallized under ONE abstract
signature (`function VAR_0`, shared by 8 of 37 code patterns), so the vault
separated them only by spatial resonance. Three changes, in decreasing order of
how obvious they were in advance.

**1. Key code patterns by their exact intent.** `abstractSequence` gained a
`literalAtoms` mode; a code pattern (`slotFlags != 0`) is stored under
`CODE:function sum of` rather than `function VAR_0`. VAR abstraction is right
for logic - it is what lets "socrates is human" generalize to "plato is human" -
and wrong here, where it discards the token naming which function is wanted.

This is not a new idea in this file: `abstractSequence` already keeps NUMERIC
literals concrete, with the stated reason "removing the dependence on spatial
centroid proximity for arithmetic vault lookup". Same argument, second
application. The `CODE:` prefix namespaces the key so a literal signature can
never collide with an abstract one.

**2. The exact lookup must bypass the spatial machinery, not just precede it.**
Phase-1 lookup is `WHERE signature = ?` with no grid window and no resonance
threshold. Both exist to choose among rows sharing an abstract signature;
against a key that is unique by construction they can only reject a correct
match because the query's centroid drifted from the anchor it was crystallized
at - which, measured, was most of the probe's remaining silence. Non-code rows
cannot match a namespaced key, so phase 2 is untouched and runs unchanged
whenever phase 1 misses.

**3. The one that was not predicted: fast-path ORDER.** With keying fixed the
probe reached 82.8%, and the five stragglers all had their answer sitting in
the vault under a correct exact key. Code synthesis ran as the LAST fast-path
(Phase 0.5), so any earlier mechanism that produced anything at all for a
sink-terminated query won first. `function is Even |-` was answered `"even"` by
semantic derivation; `function lesser Of |-` was answered `"unknown"`. An exact
key is unambiguous by construction, so there is nothing a fuzzier mechanism can
add: the exact branch is hoisted to Phase 0a, above vault recall. Only that
branch moves - the attractor-composition fallback stays at Phase 0.5, where it
must not preempt vault recall - and deduction cannot be affected, because a
`CODE:` key exists only for a crystallized code pattern and a logic query
cannot mint one.

| round-trip (n=29) | pass@1 | abstain | confFalse |
| ----------------- | ------ | ------- | --------- |
| pre-gate | 0.0% | 58.6% | 12 |
| emission gate | 0.0% | 86.2% | 4 |
| emission fixed | 24.1% | 62.1% | 4 |
| + exact keying | 82.8% | 3.4% | 4 |
| **+ Phase 0a hoist** | **100.0%** | **0.0%** | **0** |

**The probe is now saturated and has stopped being a measurement.** 29/29 with
no silence and no error means it can no longer detect improvement, and its only
remaining value is as a regression guard - which is exactly what it is pinned
as. Any further claim about code synthesis needs a harder probe: these are
functions the engine was shown verbatim, and recall is not synthesis.

### 2026-08-01 (same day) - the toolkit: HumanEval 0.0% -> 2.5%, confFalse 0

The first HumanEval passes. Four of 159, and the mechanism matters more than
the number.

**What was wired.** The code domain's standing asset is that its oracle is
free - a candidate can be RUN. Until now only the benchmark ever spent that,
to score the engine. `Toolkit.ts` lets the engine spend it on itself: the
problem's own doctests become a goal, every stored code pattern is a candidate,
all candidates are executed against the goal in one batched program, and only a
candidate that passes is committed. Nothing that fails verification is ever
emitted, so the covenant's characteristic failure is free here by construction.

The goal was already in the data and was being discarded: **156 of 159 problems
carry `>>> call` / expected-value doctests, 443 in total**, and `docSurface`
dropped them as noise.

**This is explicitly NOT search.** It enumerates what the vault holds and tests
it; it composes nothing toward a goal and has no notion of a behavioural type.
It was built to answer one question - *can any composition the current library
can express pass a real problem* - because the answer decides whether the next
mechanism is search or vocabulary.

| toolkit (n=159) | pass@1 | abstain | confFalse | self-verified |
| --------------- | ------ | ------- | --------- | ------------- |
| 1-example floor | 2.5% | 96.2% | 2 | 6 |
| **2-example floor (pinned)** | **2.5%** | 97.5% | **0** | **4** |

**The four passes are transfer, not recall**, which is the interesting part:

| problem | solved by | why |
| ------- | --------- | --- |
| `HumanEval_23_strlen` | `count` | counts elements of an iterable; strings are iterable |
| `HumanEval_30_get_positive` | `filterPositive` | the same function under a different name |
| `HumanEval_35_max_element` | `largest` | same |
| `HumanEval_53_add` | `concat` | `a + b`, written for strings, is addition for numbers |

`concat` solving `add` and `count` solving `strlen` are not name matches - the
names have nothing in common. They were found by **execution**, which is the
one retrieval channel that does not care what anything is called. Note the
contrast with the same session's earlier fix: exact-intent keying works when
the request names the thing, and is exactly useless here.

**A specification floor, and why it is not arbitrary.** The first run committed
6 and passed 4; both false commitments came from problems carrying a SINGLE
example (`smallest` "satisfying" `mean_absolute_deviation`, and `add`). One
example is not a specification - it is one point, and any number of wrong
functions pass through a point. Requiring two costs reach on 30 of 159 problems
(the corpus's own histogram: 3 problems have 0 examples, 27 have 1) and buys
confFalse 0. All four genuine passes had two or more, so the trade cost nothing
real here. After it, **self-verified equals official-pass exactly** - the
toolkit has stopped lying to itself, which is the property worth having.

**Honest ablation, stated so the number cannot be over-read.** The doctests are
parsed by `parseExamples` and handed in. Turning prose into a specification is
work the Language layer cannot do (§3.1 territory), so this isolates
composition from reading exactly as the round-trip probe isolated the channel
from reading. A toolkit that needed its examples pre-parsed in production would
not be finished.
