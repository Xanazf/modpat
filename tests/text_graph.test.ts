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
import Store from "@core_s/Memory";
import { groundGraphIntoSystem } from "@core_s/grounding/AstGrounding";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { buildGraphFromText } from "@core_s/grounding/TextGraph";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { EdgeKind, NodeKind } from "@core_s/helpers/enums";
import { random, seedRandom } from "@utils/seededRandom";
import logger from "@utils/SpectralLogger";
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
  });
}
