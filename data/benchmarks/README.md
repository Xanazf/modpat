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

The 2026-07-23 pin (rule discharge, TEXT_GRAPH_RULE_DISCHARGE_ENABLED) was
accepted via `--accept` over two flags (honest.ruletaker.d2 confFalse 0→1,
honest.overall confFalse 4→5). The audit: all 5 confident falsehoods are
perception-path token-soup commitments on Rel* (verb-relational) items -
GraphQuery is silent there by design (pair-scoped firewall), so the discharge
closure never ran for any of them; a discharge answer is a clean canonical
sentence (confidence 0.85, provenance "rule-discharge") and produced ZERO
wrong commitments across all 160 items. The new rt.d2 offender
(RelNoneg-D2-1879-6) was ablated single-item: its garbage answer is
byte-identical with the discharge flag on and off - the +1 is the
pre-existing mapper-coin-flip-on-garbage class shifted by the ingestion-side
soundness fixes (generic re-classification off the asserted ledger + the
bound-variable pronoun fix), not a mechanism falsehood. The gains are the
d1+ rule-hop wall coming down: proofwriter d1 33.3%→75.0%, d2 33.3%→58.3%,
d3 33.3%→83.3%, d5 33.3%→75.0% (confFalse 0 on d0–d3); ruletaker d1
5%→50%, d2 15%→45%, d5 10%→50%. Remaining ruletaker false-recall is
negation-as-failure territory (the flagged closed-world mode, PARITY §3.2
stage 2); remaining relational (Rel*) items need relational rule support,
deliberately out of stage-1 scope.
