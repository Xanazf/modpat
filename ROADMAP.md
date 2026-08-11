# ModPAT Roadmap - The Faithful Grounding Arc

## North star

> Everything is topology, and everything that happens on a topology is traversal.
> Physics, logic, language, and code are the same thing seen four ways.

ModPAT is not an inference engine that *checks* validity against rules, nor a model
that *approximates* answers from weights. It is a **map of a domain's own topology**,
and inference is geodesic traversal across that map.

The load-bearing consequence:

> **If the manifold is a faithful map of a domain's topology, then a coherent geodesic
> through it _is_ a correct inference - necessarily, with no external oracle.**

So "never emit a wrong proof or snippet" is not enforced after the fact. It is a
structural property of two things being true at once:

1. **Faithfulness** - manifold distance/curvature mirror the domain's real structure.
2. **Coherence-gating** - only traversals that cohere with that structure are emitted.

A wrong answer is, by definition, one that is *incoherent with a faithful map*. There is
nothing to verify externally; the geometry already knows.

### Why this can exceed frontier LLMs in deterministic domains

LLMs operate on an **implicit** topology - the structure of the data is latent inside
the weights, never made explicit, and is navigated by next-token prediction over a
hyperdimensional array. ModPAT makes the topology **explicit** and navigates it
directly, the same way Data-Oriented Design navigates the CPU's explicit cache
topology and beats pointer-chasing by an order of magnitude. Explicit topological
grounding is both more *correct* (coherence is checkable in the geometry) and more
*efficient* (traversal is cache-coherent array work, not dense matmuls).

### The crux this arc attacks first

Today the manifold's primary coordinate, `posX`, is assigned from **GloVe → UMAP**
(`SemanticAtomizer`). GloVe is a statistical co-occurrence embedding - an
*implicit-topology* artifact of exactly the kind the thesis deems inferior. "Words that
co-occur are near" is **not** "the object 2 m away is a precept 2 m away," and it is not
"a function is near the functions it calls." `posY` is worse: a trivial token-order
index (`i * 0.1`).

The fix is the **direct grounding channel**: coordinates come from the source domain's
*own observable topology*, never from text statistics.

### The converged thesis (sharpened 2026-06-11, after adversarial review)

The defensible form of the north star - each clause measured or measurable,
none rhetorical:

> **Explicit terrain, forced traversal, errors with addresses, principled
> abstention - pending the survey loop that lets the territory correct the map.**

- **Explicit terrain.** The topology is a queryable map, not latent weights.
  The claim is *comparative*, not exclusive - implicit topologies are also
  navigable (an LLM forward pass traverses the structure latent in its
  weights; this document says so above). Explicitness buys two things the
  implicit form cannot offer: **checkability** (coherence is a geometric
  predicate the system can evaluate about its own traversals - the gate) and
  **locality of writes** (knowledge updates touch a neighbourhood, not every
  parameter - continual learning without catastrophic forgetting, by
  construction).
- **Forced traversal.** Validity by construction: settling is
  Lyapunov-guaranteed descent, so a traversal cannot wander off the terrain -
  wrong paths are dynamically inaccessible *relative to the terrain*. The
  forcing guarantees consistency-with-terrain, never truth-about-the-domain:
  the shuffled-coordinate null settles just as lawfully and is wrong
  everywhere (onPath ~0.1). The physics forces; **the terrain decides**;
  everything rides on who carves the terrain.
- **Errors with addresses.** The failure-mode contract. Where the embedding
  homomorphism is exact (the number line: posW composition IS addition),
  error is structurally inexpressible - the topology cannot form as
  "2+2=3" *provided the carver (`reduceAdditive`) is correct*; the guarantee
  is inherited from the constructor, same class as a calculator's, and the
  geometry re-presents it rather than generates it. Where the homomorphism is
  approximate (graph domains, pearson 0.944), errors degrade into
  **misunderstandings** - wrong-but-coherent renderings of a defective
  terrain region that can be pointed to, inspected, and fixed locally - never
  confabulations without a locus. The boundary is measured, not asserted
  (the calibration corpus's wrong-but-coherent class; disj1/neg1 live there
  today).
- **Principled abstention.** The gate emits only what the terrain supports.
  The characteristic failure under a missing mechanism is silence, not
  confident falsehood (R4/R5 regressed to `unknown` for months - wrongly
  silent, never wrongly assertive); the wrong-but-coherent class is
  intercepted by the gate's anti-echo signal rather than cured by it.
- **Pending the survey loop.** The missing clause, and the load-bearing one.
  All current fidelity is *parse-relative*: the terrain is validated against
  the graph the terrain was built from - circular by construction. A map
  earns "right" only by contact with the territory. See **Phase 4.5**.

---

## The unified domain: code = logic = math

All three are **typed directed graphs over terms**, sharing exactly three edge kinds:

| Edge kind       | Code                          | Logic                     | Math                        | Axis effect            |
| --------------- | ----------------------------- | ------------------------- | --------------------------- | ---------------------- |
| **containment** | dir/file/AST nesting          | sub-formula / quantifier scope | operator tree / operands | depth → **posZ**       |
| **reference**   | import / call / type-use      | premise → rule, name use  | definition use, variable    | adjacency (attraction) |
| **reduction**   | β-reduction / evaluation      | modus ponens, instantiation | arithmetic eval, equality | co-location of equals  |

Plus two structured coordinates:

- **kind** (type / class / fn / var / literal / operator) → **posY**
- **number line / version / recency** → **posW** (numeric literals already use `posW = n × 0.1`)

`astExtract.ts` already emits this graph for TypeScript as typed triples
(`extends`, `calls`, `has`, `returns`, `is`, `exports`, …) with a `kindY` and a
`callDepth` hint. The structure is *already captured* - it is currently flattened to
text and pushed through the embedding bottleneck (`AstSeedWorker → ingestSequence`),
and its edges are stored as **vault proofs** rather than **spatial adjacency**. The arc
turns that captured structure into geometry.

### Deduction and code are the same shape; induction is its inversion, not just its mirror (theorized, 2026-07-23)

PARITY §3.2's rule discharge (`GroundRule`: `conditions[] → conclusion`, built
this session) and a code `if`/`else` (`test → consequent`) are the identical
topological shape - condition(s) resolving to a conclusion. Verified this is
NOT yet wired, not merely latent: `astExtract.ts` never visits `IfStatement`
(control flow is invisible to the structural-grounding side, not flattened -
absent); `AstGrounding.ts` has no `rules` concept at all; `Coder.ts`'s
`Synthesizer` handles `IfStatement` only as template shape-matching (tag the
test's identifiers as slot variables, crystallize `intent → "if (VAR_0 >
VAR_1) {...}"`) - it never evaluates the condition, so it isn't discharge.
The extraction pattern transfers directly (same move as `tryExtractConditional`,
different token source), but the one real complication is that a RuleTaker
fact is static ground truth while a code condition is about a *runtime*
value - discharging it needs execution as the ground truth (the survey
loop's behavioural-fidelity channel, already built for code, PARITY §3.5)
rather than an asserted-fact ledger.

The sharper claim, corrected same day: **induction is not merely the same
`GroundRule` triple viewed differently - it is that triple with the solve
direction INVERTED, and the inversion is double.** (1) Algebraic inversion:
deduction fixes `(rule, conditions)` and solves for `conclusion` (what §3.2
discharges); induction fixes `(conditions, conclusion)` - observed across
several example cases - and solves for the *rule* that explains them.
(2) Epistemic inversion, the half a passive "mirror" misses entirely:
deduction is **truth-preserving** - given a faithful terrain, a discharged
conclusion is correct by construction, the same "errors structurally
inexpressible" guarantee the exact-domain reduction work already leans on.
Induction is **not** truth-preserving in that sense - a rule generalized
from finitely many examples can be wrong even when it fits every example
seen so far (the classical problem of induction: no finite evidence entails
a universal). Running the shape backward does not carry the forward
direction's certainty backward with it. This is the same asymmetry the
architecture already encodes physically elsewhere: negation is a point
reflection *through the origin* (`WaveResolver`'s antipode contract) - a
true inversion, not a mirror across a plane, and it is the closer geometric
analogy here too.

Consequence: an **induced** rule is not admissible on the same terms as a
**discharged** conclusion - it needs the verification a discharged
conclusion is exempt from, which is not a new mechanism to invent but the
survey loop's existing job (behavioural fidelity against execution, PARITY
§3.5) pointed at a different kind of candidate than it currently surveys.
If code's control flow lived in this graph, code synthesis-from-examples
(§3.5, the current long pole) would decompose into: **induce** the
`GroundRule` from example input/output pairs or execution traces (the
actual missing mechanism - not "harder code generation" in the abstract),
**render** it to source text (`Synthesizer`'s template instantiation
already does this well), then **survey** it against held-out
examples/execution before trusting it - the induction step inherently
needs the check the deduction step never did. Recognizing the if/else shape
was never the hard part; inducing the right general rule from few examples,
and knowing not to trust it unchecked, is.

**Gate before building:** the same discipline as the degree-placement note
above - confirm induction can recover a KNOWN simple rule (e.g. a single
comparison threshold) from a handful of clean input/output examples, AND
that the survey step actually catches a wrong overgeneralization (e.g. a
rule that fits the given examples but fails a held-out one), before
committing to wiring either through the unified graph and the Synthesizer.
If it can't recover even the simple case cleanly, or the survey step
doesn't catch the seeded overgeneralization, the inversion framing is
elegant but not yet a mechanism.

---

## Phases

### Phase 1 - Structure-grounded ingestion + a faithfulness metric  ← **complete**

Replaced GloVe-derived `posX` and trivial `posY` with graph-derived coordinates;
edges represented as geometry (adjacency), not just vault proofs. `GroundGraph` IR
→ `StructuralGrounding` placer → `mapFidelity` metric. Validated: pearson 0.94 /
separation 2.65 vs null ≈ 0 / 1; a function's nearest precept is one of its callees.

### Phase 2 - Coherence as the intrinsic emission gate  ← **complete**

`Coherence.gateEmit` combines terrain coherence with an anti-echo signal; wired
into `perceive` under `opts.gated`. Gate is provenance-aware (rule-free cluster
candidates get no short-output trust). Graded abstention: definitive → hedged →
silent. Repair operator measured at zero payoff (see `FINDINGS.md`); stays unwired.
Gate: **100% balanced accuracy** on 17-case calibration corpus (14/14 emit-correct,
3/3 abstain-wrong).

### Phase 3 - Reduction as traversal (computation falls out of geometry)  ← **complete**

Reduction edges are traversable: computing = moving. Additive arithmetic via W
number-line composition, universal instantiation via IS-graph traversal, negation
as NEGATIVE edges, disjunctive syllogism via rule discharge, modus ponens via
`dischargeRules` to fixpoint. All wired end-to-end as fast-paths in
`Perception.observeSettlingGradient`.

### Phase 4 - Faithful traversal & DOD-fast navigation  ← **complete**

Traversal replaced with Lyapunov damped-particle settling (IVP, monotone by
construction). ~2.4–3.2x faster than baseline. Self-calibrating bias (escalate λ
until arrival). Incremental operator-anchored placement for large graphs.
Contrast/stance axis via signed field. Logic/math cross-corpus sweep: mean static
pearson 0.98, dynamic onPath 0.95. C3 Ricci flow and C4 Christoffel learning both
measured dead ends (see `FINDINGS.md` and `REGISTRY.md`). Production onPath 0.95.

### Phase 4.5 - The survey loop (territory-corrected terrain)  ← **complete**

Three channels: arithmetic (`BehaviouralFidelity.ts`), code
(`CodeBehaviouralFidelity.ts`, tsx execution), closed-world logic
(`ClosedWorldFidelity.ts`, model check). All at 1.0 fidelity on exact domains;
logic baseline 0.844 (the honest approximate-embedding number). Seeded
mis-survey repair demonstrated across all channels with locality of writes.
Wired into `learnCycle` via `SurveyLoopRunner.ts` with multi-fault robustness.
Self-vs-KB influence bench: complementary channels (self = free exact-domain
maintenance; KB = authored relational coverage).

### Phase 5 - Coordinate-source migration (retire GloVe as default)  ← **complete**

Language precepts derive `posX` from referents' grounded positions via
`BaseAtomizer.groundedPosX`. Cold-start co-occurrence grounded toward
structurally-grounded referents (default ON). Pole-ingestion measured and rejected
(see `FINDINGS.md`). Logic/math grounding proven faithful under the same machinery
as code.

### Phase 6 - Vision channel (deferred; enabled by the unified framework)

A scene → precepts laid out mirroring observed spatial relations, reusing the same
graph-grounding machinery (a scene graph is just another typed graph; spatial relations
are its edges). The unified code/logic/math framework is the prerequisite; once
grounding is faithful, vision is "just another graph."

**Done so far:** `SceneGraph.buildGraphFromScene` + `SceneAtomizer` ground scenes
through the same IR / placement / fidelity machinery (mean static pearson 0.99,
dynamic onPath 1.00). Guarded by `tests/scene_grounding.test.ts`. **Remaining:**
camera/sensor pipeline (the scene currently comes from a structured description,
not a visual input).

### Phase 7 - The Subject (agency layer; post-grounding)

The layer above the manifold: an autonomous subject that sets its own goals and keeps
its own identity. This is where **SRMCA** - the project's earlier neural-idiom blueprint
- folds back in. Its agentic core is the spec, re-expressed on the geometric substrate
(it reads gauge-invariants only; no dense-vector Hopfield).

- **Telegenesis (goal-setting):** propose goals by a multi-criteria utility - info gain
  (*where is the map thin or high-curvature? = where it is least faithful*), empowerment,
  consistency (coherence with existing topology), reciprocity, minus violation
  (incoherence with foundational/eternal precepts). Extends the current intent /
  `InquiryQueue` system.
- **Initiative loop:** Idle → Observe → Evaluate → ProposeGoals → Decide → Plan → Act →
  Log → Reflect. The grown-up form of `_cogTick` + `startAutonomy`.
- **Coherence-as-Anima:** the Phase 2 intrinsic coherence gate *is* `Anima.check` - a
  goal/plan is admitted only if it coheres with the map. The function SRMCA assigned to
  an external SMT prover, now geometric.
- **Commitments + SelfNarrative:** persistent goals and identity as heavy, slow-decaying
  precept structures (the stable-context / eternal anchors that also fix the gauge).
  Reflection consolidates episode trails into low-curvature stable structure.
- **Subjectivity metrics:** telegenesis index, autonomy ratio, identity consistency,
  return-on-curiosity, planning quality - as observability gauges.
- **Self-regulation:** upgrade the Ricci/Christoffel control from proportional-only to
  PID for stability.

Depends on P1 (faithful map) + P2 (coherence gate); independent of vision, so
parallelizable with P6.

**Done so far:**
- `electSkill` potential-field election: built + validated; LIVE as of 2026-07-05
  (the `seedCapabilities` scope/id conflation that kept it dormant is fixed -
  capability wells are real Capability-tagged precepts resolved via
  `getIdsByScope`; see `FINDINGS.md` RESOLVED addendum).
- Backward-W propagation: reasoning-vs-rationalization as a measurable amplitude
  (`Traveler.inferenceAmplitude` / `inferenceDirection`), the hook P7's Reflect step
  will use. 0 violations over 500 random inferences.
- **Bitemporal W + organic direction (2026-06-30).** Added stable timeline buffers
  `wBirth`/`wStart`/`wStop` to `ManifoldSOA` (born-position + valid interval; never
  decayed), distinct from volatile `posW` (firing recency). `DirectionalPropagation`
  now reads `wBirth` for *distance* with **signed Δw** (the backward penalty applies
  only to the descending-into-older-knowledge component), and derives *direction*
  from the `posW` origin (`inferPropagationMode`) instead of a caller label.
  `resolveReferents` remaps throwaway probe atoms to their established referents.
  Two symmetric mechanisms make the direction an emergent property of *which
  mechanism ran*: `assessForwardSupport` (premises presented ⇒ fire ⇒ reasoning;
  the learner delegates to it) and `justifyIntent` (an intent fires, reaches back to
  older established memory ⇒ rationalization). Guards: `tests/timeline_buffers`,
  `directional_propagation`, `directional_corpus` (labeled corpus, 100% w/ remap vs
  50% control), `directional_organic`. Falsifiable claim (backward systematically
  lower amplitude) holds across varied spreads.

**Prerequisites for faithful intent justification (open, 2026-06-30):**
The current `justifyIntent` support-gather is a placeholder (the topic's own
established memory + perception reach) - association-flavoured. The architecturally
correct primitive is **not co-occurrence** ("what appeared near X" is an implicit /
distributional artifact, the kind the north star deems inferior) but **solving the
same equation, distinguished by magnitude along a shared direction**: "hungry" and
"starving" are not co-occurrence neighbours - they are the *same direction* (same
kind/quality axis) at *different radius* (severity), both solutions to a constraint
superposition ("haven't eaten | calories unmet | stomach empty"). This is the radial
sibling of the antipode-negation already wired (negation flips direction; **degree
slides magnitude along it**), and it is THEORY.md's *degrees of motivation* /
*OR-as-median* made operational (the constraint disjunction's combined amplitude
*is* the magnitude that selects hungry vs starving).

Two parts, the first load-bearing:

1. **Degree/magnitude placement primitive** (atomizer). Co-graded terms must share a
   direction with **radius = intensity** - the radial dual of `AntonymLexicon`'s
   antipode stance. Today this holds only for **numerals** (`posX ∝ value`); content
   words get GloVe/UMAP direction with no severity-ordered radius. Likely needs a
   source (WordNet troponyms / intensity scales) analogous to the antonym lexicon.
2. **Directional + magnitude gather** (`justifyIntent`, and relevance generally).
   Support = concepts whose phasor **constructively interferes** with the intent
   (aligned direction = co-solutions of its equation); selection = **magnitude fit**
   (the intent's amplitude picks the degree). Antipodal/destructive candidates are
   the *contradiction*, not support. Cheap *once (1) holds*; reading magnitude off an
   unordered radius before (1) just returns noise.

**Gate before building either:** an empirical probe - place `hungry / starving /
full / sated` and measure whether degree is already latent in GloVe (high cosine
hungry↔starving, radius starving > hungry, full near-antipodal) or genuinely absent.
That result decides whether (1) is a *read* or a *construction*.

### Phase 8 - Attention span & recursive context (working-set mechanics)

Everything allocated in the manifold is currently equally *hot*. There is no working
set, so "what the Traveler is attending to right now" is not a representable object -
which caps how deep an inquiry can go before it either drags the whole manifold along
or loses its place. This phase makes attention explicit and makes inquiry **recursive**:
a stalled inquiry spawns a sub-inquiry that builds its own context, that context settles
out of attention, and its residue re-enters later *by proximity* rather than by recall.

Conceptual source: `COGNITOHAZARD.md` §3/§5/§7 (parameter space, and navigating the
parameter space of one's own navigation). Everything below is **theorized**; the tagging
discipline applies with extra force because that framework is self-reinforcing by its
own §8 - a mechanism it inspires needs a guard test that *could fail*, or it is a lens
artifact rather than a finding.

**The reframe (load-bearing): attention is a valid-time window, not a cache.**
The obvious design - page precepts between manifold (hot) and vault (cold) - is wrong
here, because manifold position is *relational*: it comes from SMACOF layout against
neighbours. Freeing slots does not merely remove atoms, it changes the metric for
every atom that remains, and re-promotion cannot restore an atom to where it was
because "where it was" was defined by neighbours that may now be gone.
`GraphQuery.ts`'s header documents the adjacent failure directly (independent layouts
landing arbitrarily close to unrelated clusters - the reason the ledger exists instead
of distance-based chain search). Paging would reintroduce that hazard on every context
switch.

The bitemporal buffers already provide a cold tier that moves nothing:

| state | predicate | meaning |
| ----- | --------- | ------- |
| dormant | `wStart > now` (`System.ts:548`) | cold, not yet in play |
| active  | `wStart <= now < wStop` (`System.ts:543`) | **hot** |
| lapsed  | `wStop <= now` (`System.ts:553`) | cold, demoted |

Demotion becomes *stamping `wStop`* - no deallocation, no re-layout, geometry preserved
exactly, and promotion is extending `wStop`, which restores an atom to precisely the
position its neighbours defined because it never left. `wBirth` is never decayed, so
identity survives demotion (Phase 7, 2026-06-30).

**What already exists (measured), and why it is the wrong split:**
- Manifold vs. DuckDB vault is a real hot/cold boundary, but it is drawn on
  **persistence**, not attention.
- `IntentTag.VAULT_PROMOTE` (`Traveler.ts:1564`) *is* cold→hot promotion, and
  `_scanVaultUnderexplored` spawns it for vault facts with `knowledgeState < 2`. It
  fires from autonomy idle-time sampling - it promotes what is **under-explored**, never
  what the current inquiry needs.
- `WorkingMemory.contextSeeds()` is an attention span already (recent conclusions get
  bonus initial energy in the Mapper) - but capped at 8 frames, holding only
  *conclusions*, and living in the language skill layer rather than over precepts.
- Decay exists three times (`DECAY_RATE` on mass, `AGE_DECAY_RATE` on posW freshness,
  `USAGE_DECAY_RATE` + `cullWeakWaveForms` in the vault). What is missing is **demotion
  from manifold to vault**; `freeLocation` is deallocation, not demotion.

**Step 1 - Attention as valid-time (verification first, then wiring).**
Open question to settle before anything else: does the settling/propagation path
actually *consult* `isActive`, or are those predicates read only by the ingest/query
layers? `W_PROPAGATION_DECAY` / `PHI_TEMPORAL_DECAY` attenuate along W, which is **not**
the same as valid-time gating. If propagation does not gate on `isActive`, wiring that
gate *is* the implementation, and the whole phase rests on it. Guard: a precept stamped
lapsed must stop contributing to settling while remaining recoverable at its original
coordinates.

**Step 2 - Demand-driven promotion.** Re-point `VAULT_PROMOTE` at the *current*
context's unresolved topics instead of idle sampling. Steps 1+2 together give hot/cold
plus demand-driven promotion with no new subsystem, and constitute the cheapest honest
test of the whole direction.

**Step 3 - Recursive context construction.** A stalled inquiry spawns a sub-inquiry
(the disinfo case: "is this framing malicious?" is unanswerable from the cluster and
requires a historical baseline). The sub-context settles to lapsed on completion; its
atoms remain positioned, so subsequent settling over the parent context passes through
them **when they are near** - relevance becomes a *measured* quantity rather than a
retrieval heuristic. If the sub-inquiry's atoms land far from the parent's topics, the
excursion was irrelevant and simply does not fire. This is the property RAG cannot
offer: the terrain was reshaped, so the return is not "old context + new findings" but
the same settling problem on a different manifold.

Needs a recursion budget with the same discipline as the discharge fixpoint
(`MAX_HOPS = 8`, `MAX_RULE_ITERATIONS = 16`); `InquiryQueue`'s status ladder and
`_intentFailureCount` are the natural hooks. Also needs a definition of *concluding*
that distinguishes a resolved sub-inquiry from an abstaining one - given the gate,
abstention will be common, and if both demote identically the residue is the same
either way. That distinction is probably where the design earns or loses its value.

**Step 4 - The meta-level (what would make this a parameter-space move at all).**
Steps 1-3 are a **trajectory through** parameter space: paths that deposit residue which
later paths traverse. Rivers do that (`COGNITOHAZARD.md:94` - the stream bed). The
meta-level requires the sub-inquiry to change **how the system does sub-inquiries**, not
just what terrain they run on - `COGNITOHAZARD.md:108`'s recursion is over *method*, not
content. Concretely: the outcome of an excursion revises the spawn/demote policy itself
(what counts as stalled enough to branch, how long residue stays hot before `wStop`,
which proximity threshold fires a recall). Hook: `decayIntent`'s 0.5/0.9 success/failure
split (`Traveler.ts:1589-1592`) is already a policy update loop, but it only adjusts
*which* intent fires next, never *how* intents are formed. Widening it from
intent-selection to intent-generation is where this appears in the tree rather than only
in the description of the tree.

**Constraint (load-bearing): proximity recall is an attack surface.** If cold context
fires by atom proximity, then whoever authors the input text controls where its atoms
land and therefore *which stored context gets recalled* - an adversary can compose text
that sits near favourable evidence and away from unfavourable. This is the natural
adaptation once the mechanism is known, not a hypothetical. Mitigation: sub-context
residue carries a provenance stamp in the spirit of `TextGraph`'s `hypothetical`
(`TextGraph.ts:194-200`), and **proximity may raise a topic but never close an
inference**. Guard test required, not optional.

**Evaluation domain: DISARM-framed disinformation analysis** (`DISARM.md`,
`DISARM_GRAPH.md`). Chosen because it exercises exactly the recursive shape (a claim
cluster whose assessment requires an excursion into an unrelated corpus) and because it
is honest about where ModPAT does *not* compete: the R-GCN of `DISARM_GRAPH.md` §5 is
supervised, and this system has no backprop anywhere - `learnCycle` crystallizes
derivation paths, it does not fit parameters. The defensible role is **adjudication
behind a detector**, not detection: a cheap statistical layer generates candidates at
scale, ModPAT reasons over the survivors and returns AFFIRM / DENY / **silence** with a
derivation address. That plays to the measured strength (deduction residual is pure
silence, confFalse 0 - PARITY §2 third update) in the one phase of DISARM where a false
positive is most costly. Note also the convergence with `COGNITOHAZARD.md` §4: "what
does it do" rather than "what is it" is the same move DISARM makes when it defines CIB
behaviourally, "regardless of topic or content validity".

Two caveats to keep the domain honest: the 83.8% deduction figure was measured on
RuleTaker/ProofWriter surfaces (clean synthetic declaratives) and **does not transfer**
to social text, which is adversarially shaped to break parsers; and relational discharge
covers SVO but not prepositional or multi-clause relations, which is most real-world
claim surface. Separately, ingestion is belief formation here (`learnCycle` crystallizes;
`Unfolder` fills from external sources), so pointing this at a disinformation corpus
without a genuine quarantined-ingestion mode means the vault absorbs the disinformation
as terrain. That mode is a prerequisite for the domain, not a nicety.

**Gate before building Steps 3-4:** run Steps 1+2 and measure whether proximity residue
from a completed excursion fires on *relevant* terrain at a rate distinguishable from
chance. If a shuffled-residue control (the Phase 4 null's analogue: deposit the same
atom count at shuffled coordinates) fires just as often, the mechanism is adding noise
and the recursive superstructure is not worth building. That result decides the phase.

Depends on P7's bitemporal buffers (done); otherwise independent of P6. Enabling for
P7's initiative loop - Observe→Evaluate→Plan has little to work with until an inquiry
can go deep without dragging the whole manifold along.

---

## Completed work ledger

All items below are done and guarded by tests. Detailed findings and measured
negatives are recorded in `src/_research/FINDINGS.md`; mechanism replacements in
`src/_research/REGISTRY.md`.

### Wave-logic channel (2026-06-21)

- Lexical antonym positioning via WordNet lexicon (`AntonymLexicon`,
  `BaseAtomizer.applyLexicalAntonymStance`). ADJ/ADV/VERB only; NOUN antonyms
  excluded (relational, not contrary). Guarded in `tests/wave_resolver.test.ts`.
- `resolveWave` emits modus-tollens conclusions with graded confidence (the
  opposition family beyond contradiction). E1Formula stays the fast cache; Wave
  is the fallback authority. Guarded in `tests/wave_resolver.test.ts`.
- E1w wave block runs in probe mode (pure geometry, no side effects). Guarded.

### Concept composition (2026-06-21)

- `resolveCompositionQuery` wired as Perception Phase 0d: SYNTHESIS ("A and B
  make Z") and DECOMPOSE ("what is Z made of"). Active-voice and compound-name
  decompose ("how to make titanium-iridium alloy" → "titanium and iridium").
  Guarded in `tests/composition.test.ts`.

### Propositional grounding suite - 6/6 PASS

R1–R6: modus ponens, hypothetical syllogism, double-negation elimination,
conjunction elimination/introduction, modus tollens. R4/R5 regressed at
`18158be`, fixed 2026-06-03 via conjunction elimination in E1Formula.

---

## On the record - adversarial review predictions (2026-06-11)

From the review conversation that produced Phase 4.5 and the converged thesis.
The reviewer's chair is structurally rent-free ("run the experiment" wins
either way), so these are the reviewer's stakes - directional, checkable, to
be marked RIGHT or WRONG when the corresponding work runs. The author's stake
is the rest of this repository.

1. **The repair step will be harder than the Phase 4.5 sketch.** Localization
   will work where the defect sits on an exact-homomorphism edge (the number
   line, reduction edges), but naive local re-weighting will FAIL on
   graph-domain corruptions (approximate embedding, pearson 0.944) and repair
   there will require local re-placement (SMACOF over the affected
   neighbourhood) - i.e. the loop will work, but it will not be "just
   `learnCycle` re-pointed". **Wrong if** the seeded-corruption demo repairs
   cleanly by local re-weighting across both exact and approximate domains.
   ***CONFIRMED (RIGHT) 2026-06-15.** The graph-domain variant required local
   re-placement (SMACOF/Guttman relaxation), not coordinate-solving. The repair
   mechanism is domain-dependent, as predicted.*
2. **Disjunction will not fall out of the existing physics.** OR-as-median
   (NOTES.md: partial constructive interference below the commitment
   threshold) will need a genuinely new mechanism, not a calibration -
   `disj1` stays in the wrong-but-coherent bucket until one is built.
   **Wrong if** interference/superposition as currently implemented resolves
   disj1 with only threshold/weight tuning.
   ***OPEN** (re-graded 2026-06-13). The "RIGHT" was contaminated by ablation -
   the resonance path had been DELETED at `18158be` before the review, so the
   `Wrong if` criterion could not fire. The symbolic disjunctive-syllogism
   mechanism built is a real result but orthogonal to the prediction about
   physics. Untestable until the resonance path is revived. See
   `src/_research/resonance-path/capability-diff.md`.*
3. **ModPAT wins the continual-learning benchmark on the first attempt.**
   Sequential ingestion with retention measured against a fine-tuned
   transformer baseline: locality of writes ⇒ no catastrophic forgetting, by
   construction. A prediction *for* the architecture, staked by its critic.
   **Wrong if** retention degrades materially with manifold growth (e.g.
   crowding/decay interactions reintroducing global interference) the way
   global-write models degrade.

---

## Status

Defaults: `SETTLING_TRAVERSE_PRIMARY=true`, `REFERENT_GROUNDING_ENABLED=true`,
`COLD_START_COOCCURRENCE_ENABLED=true`, `POLE_INGESTION_ENABLED=false`.

| metric | value | null |
| ------ | ----- | ---- |
| static grounding pearson | 0.944 | ≈ 0 |
| static separation | 2.65 | ≈ 1 |
| traversal onPath | 0.95 | 0.07 |
| logic/math pearson | 0.98 | ≈ 0 |
| logic/math onPath | 0.95 | — |
| scene pearson | 0.99 | — |
| scene onPath | 1.00 | — |
| coherence gate balanced accuracy | 100% (17 cases) | — |
| behavioural fidelity (arith) | 1.000 (132/132) | — |
| behavioural fidelity (code) | 1.000 (132/132) | — |
| closed-world fidelity (logic) | 0.844 (baseline) | — |
| propositional suite | 6/6 PASS | — |

**Last full-suite verification:** 2026-06-22.

**Next:** Phase 6 camera pipeline, Phase 7 subject/agency layer, Phase 8 Steps 1+2
(attention as valid-time + demand-driven promotion - the cheap test that gates the
rest of that phase), continual-learning benchmark (prediction 3).
