# PARITY.md - Distance to flagship-LLM parity on deterministic tasks

Written 2026-07-05, against the tree at `e9e6fe2` + the seedCapabilities fix.
Updated 2026-07-23 against `7054f59`: the honest external baseline has been
run (§2 update) and the §3.1 route-(a) first cut is built and guarded.
Updated again 2026-07-23 (same day): §3.2's first iteration - attribute-rule
discharge over the text ledger - is built, guarded, and pinned at 68.1%
balAcc (§2 second update).
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

**Second update (2026-07-23, measured): the rule-hop wall is down.** §3.2's
first iteration (attribute-rule extraction at parse time + query-time
open-world fixpoint discharge, `TEXT_GRAPH_RULE_DISCHARGE_ENABLED`) moves
the honest overall to **68.1% / 51.2% / 5**. Per-family: proofwriter d1
33.3%→75.0%, d2→58.3%, d3→83.3%, d5→75.0%; ruletaker d1 5%→50%, d2
15%→45%, d5 10%→50%. All 5 confident falsehoods are perception-path
token soup on Rel* items (the discharge closure never ran for any of them;
single-item ablation byte-identical flag on/off - see
data/benchmarks/README.md). Residuals: ruletaker false-recall needs the
closed-world negation-as-failure mode (§3.2 stage 2, flagged, unbuilt);
Rel* items need relational rule support (out of stage-1 scope); the
perception-garbage commitment class predates this work and is the next
soundness target.

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
copula-attribute rules ("if something is rough and not blue then it is not
kind", "all nice, blue things are kind") are extracted as structured
condition/conclusion records at parse time (`TextGraph`), precept-resolved
into `system.textGroundedRules` (`TextGrounding`), and discharged by
GraphQuery in a transient per-query fixpoint closure - open-world semantics
(negated conditions demand explicit contrast support; conjunctions fire only
on full match; derived-vs-asserted conflict poisons to silence; asking never
creates). Guarded in `tests/rule_discharge.test.ts` (11 cases). Honest
external: 44.3%→68.1% balAcc, zero mechanism falsehoods (§2 second update).
Still missing here: relational (verb) rules, the closed-world
negation-as-failure mode (stage 2, flagged design in the 2026-07-23 plan),
existentials, nested quantifiers, proof by cases.

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

## 5. Effort estimate (theorized, to be graded)

Distance shares: language front-end ~45%, FOL breadth ~20%, code synthesis
~15%, arithmetic ~8%, scale ~7%, expression ~5%. At this repo's demonstrated
cadence (wave channel, composition, bitemporal-W each went
idea→wired→guarded in days-to-weeks, single developer):

- **Honest external baseline** (real datasets through the pipeline): days.
  **DONE 2026-07-21** (see §2 update) - the estimate held.
- **Logic-family parity** (3.2 + 3.3 + a first cut of 3.1 via route (b)):
  months, single-digit.
- **Arithmetic + word-problem parity**: +2-3 months after 3.1's first cut.
- **Code (HumanEval-class)**: the long pole after language; ~a year.
- **Full route-(a) language grounding**: open-ended research; the hybrid
  carries parity until it lands.

On the record: **if the naturalistic hop-1 family does not clear 0.9 within
one quarter of starting 3.1, the front-end estimate above is wrong and the
distance is larger than claimed.** Wrong-if criterion included so this
document can be graded like the 2026-06-11 predictions.

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
*tasks as people pose them* is mostly one problem (the natural-language
front-end) plus four named mechanisms (FOL breadth, disjunction physics,
multiplicative/positional arithmetic, degree placement), an honest
external-dataset baseline (run 2026-07-21: 44.3% balanced accuracy at 4
confident falsehoods - the distance is now a number), and a staged curriculum
whose gates this repo has, unusually, already built and measured.
