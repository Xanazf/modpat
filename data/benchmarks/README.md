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

Final per-family movement from the 44.3% baseline: proofwriter d0
83.3%→100%, d1 41.7%→91.7%, d2 41.7%→100%, d3 41.7%→100%, d5 41.7%→91.7%
(confFalse 0 throughout); ruletaker d0 55%→70%, d1 5%→60%, d2 15%→65%,
d3 0%→75%, d5 10%→70% (confFalse 0 throughout, down from 1 each).
