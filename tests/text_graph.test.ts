/**
 * TextGraph guard tests (PARITY §3.1 route (a)).
 *
 * Three surfaces:
 *   1. Parse correctness - hard asserts on nodes/edges/contrasts for the
 *      grammatical constructions the builder claims to handle.
 *   2. Subsumption differential - TextGraph ⊇ LogicGraph on every corpus the
 *      logic/math sweep grounds, so the grammatical path can never silently
 *      lose the symbolic grammar (the delegate-first design made this true by
 *      construction; this test keeps it true).
 *   3. Fidelity guard - naturalistic corpora placed by the SAME machinery
 *      clear the structural-grounding bars (pearson/separation beat the
 *      shuffled null; traversal stays on path).
 */

import * as assert from "node:assert";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundGraphIntoSystem } from "@core_s/grounding/AstGrounding";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { buildGraphFromText } from "@core_s/grounding/TextGraph";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { EdgeKind, NodeKind } from "@core_s/helpers/enums";
import Store from "@core_s/Memory";
import {
  questionToProposition,
  resolveGraphQuery,
} from "@skill_cogi/GraphQuery";
import logger from "@utils/SpectralLogger";
import { random, seedRandom } from "@utils/seededRandom";
import { CORPORA } from "../scripts/dev/logic_math_corpus_sweep";
import { describe, it } from "./utils/harness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Graph = Grounding.GroundGraph;

function labelOf(g: Graph, id: number): string {
  return g.nodes[id].label;
}

function hasEdge(g: Graph, from: string, to: string, kind?: EdgeKind): boolean {
  return g.edges.some(
    e =>
      labelOf(g, e.from) === from &&
      labelOf(g, e.to) === to &&
      (kind === undefined || e.kind === kind)
  );
}

function hasContrast(g: Graph, a: string, b: string): boolean {
  return (g.contrasts ?? []).some(c => {
    const la = labelOf(g, c.a);
    const lb = labelOf(g, c.b);
    return (la === a && lb === b) || (la === b && lb === a);
  });
}

function nodeByLabel(
  g: Graph,
  label: string
): Grounding.GroundNode | undefined {
  return g.nodes.find(n => n.label === label);
}

/** Shuffled-coordinate null at the sweep's scale (logic_math_corpus_sweep). */
function shuffledPlacement(n: number): Grounding.Placement {
  seedRandom(1234);
  const p: Grounding.Placement = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: new Float64Array(n).fill(1),
  };
  for (let i = 0; i < n; i++) {
    p.x[i] = (random() - 0.5) * 200;
    p.y[i] = (random() - 0.5) * 200;
    p.z[i] = (random() - 0.5) * 200;
    p.w[i] = random() * 2;
  }
  return p;
}

// Naturalistic corpora for the fidelity guard - hop-1 surface forms of the
// kind the external benchmark scores at 0.60 through the pattern lexicon.
const NATURALISTIC_CORPORA: Array<{ name: string; statements: string[] }> = [
  {
    name: "naturalistic taxonomy",
    statements: [
      "cats are mammals",
      "dogs are mammals",
      "mammals are animals",
      "birds are animals",
      "animals are organisms",
      "felix is a cat",
      "rex is a dog",
      "tweety is a bird",
      "rex chased felix",
      "tweety can fly",
    ],
  },
  {
    // No large numerals here on purpose: a numeral's posW is its VALUE (the
    // number-line homomorphism, guarded by the arithmetic corpora), which is
    // deliberately hop-unrelated and would distort this hop-fidelity guard.
    name: "naturalistic causal",
    statements: [
      "if it rains then the ground is wet",
      "if the ground is wet then the grass grows",
      "if the grass grows then the cows eat",
      "the sun heats the ground",
      "the sun heats the water",
      "steam rises because water boils",
      "the rain cools the ground",
    ],
  },
  {
    name: "mixed register",
    statements: [
      "socrates is a man",
      "all men are mortal",
      "the dog chased the cat and the cat ran away",
      "penguins cannot fly",
      "iron conducts electricity",
      "iron is a metal",
      "metals are elements",
    ],
  },
];

// ---------------------------------------------------------------------------

export async function runTextGraphTests(): Promise<void> {
  await describe("TEXT GRAPH - GRAMMAR-GROUNDED INGESTION", async () => {
    // ---- 1. Parse correctness ---------------------------------------------

    await it("parses copula membership and universals", async () => {
      const g = buildGraphFromText(["felix is a cat", "all men are mortal"]);
      assert.ok(hasEdge(g, "felix", "cat", EdgeKind.Reference));
      assert.ok(hasEdge(g, "man", "mortal", EdgeKind.Reference));
    });

    await it("splits if/then clauses and links antecedent to consequent", async () => {
      const g = buildGraphFromText("if it rains then the ground is wet");
      assert.ok(hasEdge(g, "ground", "wet"), "copula edge inside consequent");
      assert.ok(
        hasEdge(g, "rain", "wet"),
        "antecedent head -> consequent head"
      );
      assert.strictEqual(
        nodeByLabel(g, "it the ground"),
        undefined,
        "no cross-clause blob node from delegation"
      );
    });

    await it("reifies content-verb SVO with the verb as a queryable term", async () => {
      const g = buildGraphFromText("the dog chased the cat");
      assert.ok(hasEdge(g, "dog", "chase", EdgeKind.Reference));
      assert.ok(hasEdge(g, "chase", "cat", EdgeKind.Reference));
    });

    await it("turns negation into contrast pairs, not edges", async () => {
      const g = buildGraphFromText([
        "cats are not fish",
        "penguins cannot fly",
      ]);
      assert.ok(hasContrast(g, "cat", "fish"));
      assert.ok(hasContrast(g, "penguin", "fly"));
      assert.ok(!hasEdge(g, "cat", "fish"), "no adjacency for negated copula");
    });

    await it("splits compound sentences at clause conjunctions", async () => {
      const g = buildGraphFromText("felix is a cat and cats are not fish");
      assert.ok(hasEdge(g, "felix", "cat"));
      assert.ok(hasContrast(g, "cat", "fish"));
      assert.ok(
        !g.nodes.some(n => n.label.includes(" and ")),
        "no blob node spanning the conjunction"
      );
    });

    await it("distributes NP coordination and softens 'or' weights", async () => {
      const g = buildGraphFromText("roses are red or violets are blue");
      assert.ok(hasEdge(g, "rose", "red"));
      assert.ok(hasEdge(g, "violet", "blue"));
      // "pets" stays plural (compromise tags the bare token as a verb, so
      // lemma()'s noun-singularization no-ops) - assert the distribution
      // contract itself: one softened edge per disjunct.
      const g2 = buildGraphFromText("cats or dogs are pets");
      const orEdges = g2.edges.filter(
        e => e.weight === 0.5 && labelOf(g2, e.to).startsWith("pet")
      );
      assert.strictEqual(
        orEdges.length,
        2,
        "'or' distributes one w0.5 edge per disjunct"
      );
      assert.deepStrictEqual(orEdges.map(e => labelOf(g2, e.from)).sort(), [
        "cat",
        "dog",
      ]);
    });

    await it("normalizes numerals into Literal nodes with numeric set", async () => {
      const g = buildGraphFromText("water boils at one hundred degrees");
      const hundred = nodeByLabel(g, "100");
      assert.ok(hundred, "spelled-out numeral becomes '100'");
      assert.strictEqual(hundred?.kind, NodeKind.Literal);
      assert.strictEqual(hundred?.numeric, 100);
      assert.ok(
        hasEdge(g, "boil", "100"),
        "prepositional attachment to predicate"
      );
      assert.ok(hasEdge(g, "water", "boil"));
    });

    await it("links clauses through 'because' in causal direction", async () => {
      const g = buildGraphFromText("steam rises because water boils");
      assert.ok(hasEdge(g, "boil", "rise"), "cause head -> effect head");
    });

    // ---- 2. Subsumption differential: TextGraph ⊇ LogicGraph --------------

    await it("subsumes LogicGraph on every sweep corpus", async () => {
      for (const corpus of CORPORA) {
        const logic = buildGraphFromLogic(corpus.statements);
        const text = buildGraphFromText(corpus.statements);

        for (const n of logic.nodes) {
          assert.ok(
            nodeByLabel(text, n.label),
            `[${corpus.name}] missing node "${n.label}"`
          );
        }
        for (const e of logic.edges) {
          assert.ok(
            hasEdge(text, labelOf(logic, e.from), labelOf(logic, e.to), e.kind),
            `[${corpus.name}] missing edge ${labelOf(logic, e.from)} -${e.kind}-> ${labelOf(logic, e.to)}`
          );
        }
        for (const c of logic.contrasts ?? []) {
          assert.ok(
            hasContrast(text, labelOf(logic, c.a), labelOf(logic, c.b)),
            `[${corpus.name}] missing contrast ${labelOf(logic, c.a)} >< ${labelOf(logic, c.b)}`
          );
        }
      }
    });

    // ---- 3. Fidelity guard on naturalistic corpora ------------------------

    await it("grounds naturalistic corpora faithfully (vs shuffled null)", async () => {
      for (const corpus of NATURALISTIC_CORPORA) {
        const graph = buildGraphFromText(corpus.statements);
        assert.ok(
          graph.nodes.length >= 6,
          `[${corpus.name}] graph too small (${graph.nodes.length} nodes)`
        );

        // Same invocation pattern as logic_math_corpus_sweep.scoreCorpus.
        seedRandom(0);
        const sys = new System();
        const atom = new LogicAtomizer();
        await atom.init();
        const { nodeToPrecept, placement } = groundGraphIntoSystem(
          graph,
          sys,
          atom,
          { seed: 0 }
        );
        assert.ok(placement, `[${corpus.name}] no placement`);

        const fidelity = mapFidelity(graph, placement, { seed: 1 });
        const nullFidelity = mapFidelity(
          graph,
          shuffledPlacement(graph.nodes.length),
          { seed: 1 }
        );

        logger.log(
          `  [${corpus.name}] pearson=${fidelity.pearson.toFixed(3)} ` +
            `(null ${nullFidelity.pearson.toFixed(3)}) separation=${fidelity.separation.toFixed(2)} ` +
            `(null ${nullFidelity.separation.toFixed(2)})`
        );

        assert.ok(
          fidelity.pearson > 0.6,
          `[${corpus.name}] pearson ${fidelity.pearson.toFixed(3)} <= 0.6`
        );
        assert.ok(
          fidelity.separation > 1.5,
          `[${corpus.name}] separation ${fidelity.separation.toFixed(2)} <= 1.5`
        );
        assert.ok(
          fidelity.pearson > nullFidelity.pearson + 0.2,
          `[${corpus.name}] structural does not beat null by 0.2`
        );

        const traveler = new Traveler(sys);
        const trav = await traversalFidelity(
          graph,
          nodeToPrecept,
          (s, t) => traveler.traverse(s, t),
          { maxPairs: 48 }
        );
        if (trav.pairs >= 3) {
          logger.log(
            `  [${corpus.name}] onPath=${trav.onPathRate.toFixed(3)} pairs=${trav.pairs}`
          );
          assert.ok(
            trav.onPathRate > 0.4,
            `[${corpus.name}] onPath ${trav.onPathRate.toFixed(3)} <= 0.4`
          );
        }
      }
    });

    // ---- 4. Live wiring through Language.ingestAssertion ------------------

    await it("lands assertion geometry live behind the flag", async () => {
      const physics = DOPAT_CONFIG.PHYSICS as unknown as {
        TEXT_GRAPH_INGESTION_ENABLED: boolean;
      };
      const prevFlag = physics.TEXT_GRAPH_INGESTION_ENABLED;
      physics.TEXT_GRAPH_INGESTION_ENABLED = true;

      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      const resolver = new Traveler(system, atomizer, store);
      const traveler = createTestTraveler(system, atomizer, resolver, store);
      traveler.setGPUEnabled(false);
      const language = traveler.language;
      assert.ok(language, "traveler has a language layer");

      try {
        const assertions = [
          "cats are mammals",
          "felix is a cat",
          "penguins cannot fly",
        ];
        for (const a of assertions) {
          await language.ingestAssertion(a, new Uint32Array(0));
        }

        const idOf = (label: string): number => {
          const scope = atomizer.getSymbolScope(label, false);
          for (const id of system.getIdsByScope(scope)) {
            if (system.isAllocated(id)) return id;
          }
          return -1;
        };
        const pos = (id: number): [number, number, number] => [
          system.posX[id],
          system.posY[id],
          system.posZ[id],
        ];
        const dist = (a: number, b: number): number => {
          const [ax, ay, az] = pos(a);
          const [bx, by, bz] = pos(b);
          return Math.hypot(ax - bx, ay - by, az - bz);
        };

        // (a) edge-adjacent terms are metric-near relative to non-adjacent.
        const cat = idOf("cat");
        const mammal = idOf("mammal");
        const felix = idOf("felix");
        const penguin = idOf("penguin");
        assert.ok(cat >= 0 && mammal >= 0 && felix >= 0 && penguin >= 0);
        assert.ok(
          dist(cat, mammal) < dist(felix, penguin),
          "adjacent (cat,mammal) closer than non-adjacent (felix,penguin)"
        );

        // (b) negation pair sits at the exact antipode (WaveResolver bar).
        const fly = idOf("fly");
        assert.ok(fly >= 0);
        const [px, py, pz] = pos(penguin);
        const [fx, fy, fz] = pos(fly);
        const dot = px * fx + py * fy + pz * fz;
        const cos =
          dot / (Math.hypot(px, py, pz) * Math.hypot(fx, fy, fz) || 1);
        assert.ok(
          cos < -0.999,
          `contrast pair cos ${cos.toFixed(4)} not antipodal`
        );

        // (c) re-asserting creates no duplicate precepts for known labels.
        const before = [
          ...system.getIdsByScope(atomizer.getSymbolScope("cat", false)),
        ].filter(id => system.isAllocated(id)).length;
        await language.ingestAssertion("cats are mammals", new Uint32Array(0));
        const after = [
          ...system.getIdsByScope(atomizer.getSymbolScope("cat", false)),
        ].filter(id => system.isAllocated(id)).length;
        assert.strictEqual(after, before, "re-assertion deduped by scope");
      } finally {
        physics.TEXT_GRAPH_INGESTION_ENABLED = prevFlag;
        await store.close();
      }
    });

    // ---- 5. GraphQuery readout (PARITY §3.1 read side) --------------------
    //
    // The read half of the front-end: yes/no questions verified against the
    // explicit text-ground ledger. Guards the whole contract - affirm along
    // asserted chains, deny via registered contrast partners, silence
    // everywhere else (including REVERSED-direction questions, the
    // undirected-v1 confident-falsehood mode), and asking never creates.

    await it("canonicalizes yes/no question surfaces to declaratives", async () => {
      const cases: Array<[string, string | null]> = [
        ["is felix a mammal?", "felix is a mammal"],
        ["would you say felix is a mammal?", "felix is a mammal"],
        ["felix is a mammal, right?", "felix is a mammal"],
        ["is it true that felix is a mammal?", "felix is a mammal"],
        ["does it follow that felix is a mammal?", "felix is a mammal"],
        ["are roses organisms?", "roses are organisms"],
        ["is felix not a fish?", "felix is not a fish"],
        ["can felix fly?", "felix can fly"],
        ["what is felix?", null],
        ["who owns felix?", null],

        // ---- subject/predicate split (multi-word subjects) ---------------
        //
        // The auxiliary must be re-seated after the WHOLE subject NP. A split
        // that stops at the first word yields "the bald is eagle red"; one
        // that runs greedily yields "felix a is mammal". The rule is the
        // maximal determiner/adjective/noun run cut at its RIGHTMOST head,
        // and each case below pins one clause of it.
        ["is the bald eagle red?", "the bald eagle is red"],
        ["is the big kind cow young?", "the big kind cow is young"],
        ["was the old dog tired?", "the old dog was tired"],
        // A determiner may only OPEN the run - "a" starts the predicate
        // nominal, which is what keeps "felix" from swallowing it.
        ["is felix a nice person?", "felix is a nice person"],
        // Cut at the RIGHTMOST head, not the first: the tagger mis-tags
        // "round" as a Noun, so a first-noun cut would give "the round".
        ["is the round green thing kind?", "the round green thing is kind"],
        // Run exhausts the remainder -> back off one head, or there is
        // nothing left to predicate ("fly" mis-tags as a ProperNoun surname).
        ["is the fire truck red?", "the fire truck is red"],
        // Pronoun subjects carry the Noun tag and need no special case.
        ["is it red?", "it is red"],
        // Modal keeps the auxiliary; do-support drops it, so the do-support
        // path never has to find the boundary at all.
        [
          "can the bald eagle chase the mouse?",
          "the bald eagle can chase the mouse",
        ],
        [
          "does the bald eagle chase the mouse?",
          "the bald eagle chase the mouse",
        ],
        // ---- tagger-noise regressions ------------------------------------
        //
        // Both of these were found by sweeping the surfaces, not by reasoning,
        // and both fail if the split trusts compromise's tags too far.
        //
        // Mid-string articles are mis-tagged ("felix an animal" tags `an` as a
        // bare Noun), so the run must reject them by SURFACE or it swallows
        // the article and yields "felix an is animal".
        ["is felix an animal?", "felix is an animal"],
        // The subject itself can be mis-tagged: "bob rich" reads `rich` as a
        // comparative and so tags `bob` an imperative Verb, leaving no head at
        // all. Position is the fallback - the token after the aux is the
        // subject however it got tagged.
        ["is bob rich?", "bob is rich"],
        // Unsplittable -> silence, never a mis-parsed proposition.
        ["is the red?", null],
      ];
      for (const [q, want] of cases) {
        assert.strictEqual(
          questionToProposition(q),
          want,
          `canonicalization of "${q}"`
        );
      }
    });

    await it("answers ledger-decisive questions and stays silent otherwise", async () => {
      const physics = DOPAT_CONFIG.PHYSICS as unknown as {
        TEXT_GRAPH_INGESTION_ENABLED: boolean;
        TEXT_GRAPH_QUERY_ENABLED: boolean;
      };
      const prevIngest = physics.TEXT_GRAPH_INGESTION_ENABLED;
      const prevQuery = physics.TEXT_GRAPH_QUERY_ENABLED;
      physics.TEXT_GRAPH_INGESTION_ENABLED = true;
      physics.TEXT_GRAPH_QUERY_ENABLED = true;

      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      const resolver = new Traveler(system, atomizer, store);
      const traveler = createTestTraveler(system, atomizer, resolver, store);
      traveler.setGPUEnabled(false);

      try {
        // Facts through the LIVE entry point, same as the paraphrase bench.
        for (const fact of [
          "cats are mammals",
          "mammals are animals",
          "felix is a cat",
          "cats are not fish",
          "fish can swim",
        ]) {
          await traveler.process(fact);
        }
        assert.ok(
          system.textGroundedEdges.size > 0,
          "ingestion populated the edge ledger"
        );
        assert.ok(
          system.textGroundedContrasts.size > 0,
          "ingestion populated the contrast ledger"
        );

        const ask = (q: string) => resolveGraphQuery(q, system, atomizer);

        // Affirm: hop-1 and a 3-hop chain (felix -> cat -> mammal -> animal).
        assert.strictEqual(ask("is felix a cat?")?.answer, "felix is a cat");
        assert.strictEqual(
          ask("is felix an animal?")?.answer,
          "felix is an animal"
        );
        assert.strictEqual(
          ask("are cats animals?")?.answer,
          "cats are animals"
        );
        assert.strictEqual(ask("can fish swim?")?.answer, "fish can swim");

        // Deny via contrast partner: felix reaches cat, cat >< fish.
        const deny = ask("is felix a fish?");
        assert.ok(deny, "contrast-reachable question is decisive");
        assert.ok(
          deny.answer.startsWith("no,") && deny.answer.includes("not"),
          `deny phrasing: "${deny.answer}"`
        );

        // Negated question about a registered contrast affirms the negation.
        const negated = ask("is felix not a fish?");
        assert.ok(negated, "negated contrast question is decisive");
        assert.ok(
          negated.answer.startsWith("correct,"),
          `negation-affirm phrasing: "${negated.answer}"`
        );

        // REVERSED direction must be SILENCE, not affirmation. This is the
        // undirected-v1 ledger's confident-falsehood mode; the directed
        // textGroundedEdgesOut map exists exactly to kill it. If this
        // assertion fires, the ledger is inventing converse relations again.
        assert.strictEqual(
          ask("are animals cats?"),
          null,
          "reversed taxonomy question must fall through to perception"
        );
        assert.strictEqual(
          ask("are mammals cats?"),
          null,
          "reversed hop-1 question must fall through to perception"
        );

        // Rule content must never be affirmable by reachability: an if/then
        // sentence asserts NEITHER clause. Measured 2026-07-21 on the honest
        // ProofWriter run: without the hypothetical stamp, consequent-internal
        // edges turned open-world unknowns into confident falsehoods
        // (4 -> 19 overall). Rule discharge belongs to the reasoning engine.
        await traveler.process("if it rains then the grass grows");
        assert.strictEqual(
          ask("does the grass grow?"),
          null,
          "conditional consequent must not affirm from the ledger"
        );
        assert.strictEqual(
          ask("does it rain?"),
          null,
          "conditional antecedent must not affirm from the ledger"
        );

        // Reified-SVO cross-contamination: the shared verb node must not
        // bridge different assertions. "mouse visits cat" + "dog visits
        // squirrel" must NOT make "does the mouse visit the squirrel?"
        // affirmable (measured 2026-07-21: every residual honest confident
        // falsehood was a Rel* item of this shape). The DIRECT pair now
        // affirms via the pair-exact triple ledger (the future work the
        // pair-scoped stamp pointed at); the cross-bridge stays silence
        // because a triple is scoped to its own assertion by construction.
        await traveler.process("the mouse visits the cat");
        await traveler.process("the dog visits the squirrel");
        assert.strictEqual(
          ask("does the mouse visit the squirrel?"),
          null,
          "shared verb node must not bridge assertions"
        );
        const direct = ask("does the mouse visit the cat?");
        assert.ok(
          direct?.answer.includes("mouse") &&
            direct.answer.includes("cat") &&
            !direct.answer.startsWith("no"),
          `direct SVO affirms via the triple ledger: "${direct?.answer}"`
        );

        // Reflexive negation ("does not need the dog" asked OF the dog):
        // the self-contrast is discarded in the parse, but the negated
        // TRIPLE carries the polarity exactly - and dog|need|dog was never
        // asserted or denied, so the verdict is silence (not an affirmation
        // of the positive residue, the pre-triple confident-falsehood mode).
        await traveler.process("the dog needs the cat");
        assert.strictEqual(
          ask("the dog does not need the dog?"),
          null,
          "unasserted reflexive triple must fall through"
        );

        // Unknown term: silence, and asking must never create. ("planet" has
        // a dictionary scope from atomizer init - the invariant is that no
        // PRECEPT gets allocated for it by asking.)
        assert.strictEqual(ask("is felix a planet?"), null);
        const planetScope = atomizer.getSymbolScope("planet", false);
        const planetPrecepts =
          planetScope > 0
            ? [...system.getIdsByScope(planetScope)].filter(id =>
                system.isAllocated(id)
              ).length
            : 0;
        assert.strictEqual(
          planetPrecepts,
          0,
          "asking about an unknown term must not allocate a precept"
        );

        // Out-of-scope surfaces: wh-questions are not this resolver's job.
        assert.strictEqual(ask("what is felix?"), null);

        // Live wiring: the Runtime LANGUAGE skill consults GraphQuery before
        // perception, so the full process() path must surface the answer.
        const live = (await traveler.process("is felix an animal?"))
          .toLowerCase()
          .trim();
        assert.ok(
          live.includes("animal") && !live.startsWith("no"),
          `live process() answer: "${live}"`
        );
      } finally {
        physics.TEXT_GRAPH_INGESTION_ENABLED = prevIngest;
        physics.TEXT_GRAPH_QUERY_ENABLED = prevQuery;
        await store.close();
      }
    });
  });
}
