/**
 * Phase 1 - structural grounding faithfulness.
 *
 * Verifies the direct grounding channel: coordinates derived from a graph's own
 * topology produce a FAITHFUL map (graph-adjacent terms become metric-near),
 * and do so far better than a null random placement. This is the thesis made
 * measurable - if structure-grounding did not beat random, the claim "coherent
 * traversal of a faithful map = correct inference" would have no foundation.
 */

import * as assert from "node:assert";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import {
  groundAstIntoSystem,
  groundGraphIntoSystem,
} from "@core_s/grounding/AstGrounding";
import {
  buildGraphFromAstTriples,
  EdgeKind,
  NodeKind,
} from "@core_s/grounding/GroundGraph";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import {
  placeGraph,
  placeGraphIncremental,
  randomPlacement,
} from "@core_s/grounding/StructuralGrounding";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { extractAstTriples } from "@utils/astExtract";
import logger from "@utils/SpectralLogger";
import { random, seedRandom } from "@utils/seededRandom";
import { describe, it } from "./utils/harness";

// A self-contained source with clear containment (has) and reference (calls,
// is, accepts, returns) structure, so the extracted graph spans a range of
// hop distances.
const SAMPLE_SOURCE = `
interface Result { code: number; message: string; }
interface Config { retries: number; }

class Engine {
  cfg: Config;
  start(): Result { return this.boot(); }
  boot(): Result { return this.validate(); }
  validate(): Result { return { code: 0, message: "ok" }; }
}

class Logger {
  write(line: string): void {}
  flush(): void { this.write("flush"); }
}

function bootstrap(engine: Engine, log: Logger): Result {
  log.write("starting");
  const r = engine.start();
  log.flush();
  return r;
}

function shutdown(engine: Engine): void {
  engine.validate();
}
`;

export async function runStructuralGroundingTests(): Promise<void> {
  await describe("PHASE 1 - STRUCTURAL GROUNDING FIDELITY", async () => {
    await it("extracts a non-trivial graph from TS source", async () => {
      const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
        includeCallSites: true,
      });
      const g = buildGraphFromAstTriples(triples);
      logger.log(
        `  graph: ${g.nodes.length} nodes, ${g.edges.length} edges ` +
          `(${triples.length} triples)`
      );
      assert.ok(g.nodes.length >= 8, "expected a sizeable node set");
      assert.ok(g.edges.length >= 8, "expected a sizeable edge set");
    });

    await it("structure-grounding yields a faithful map, beating random", async () => {
      const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
        includeCallSites: true,
      });
      const g = buildGraphFromAstTriples(triples);

      const structural = placeGraph(g, { seed: 0, iterations: 150 });
      const random = randomPlacement(g, 777);

      const fStruct = mapFidelity(g, structural, { seed: 1 });
      const fRand = mapFidelity(g, random, { seed: 1 });

      logger.log(
        `  structural: pearson=${fStruct.pearson.toFixed(3)} ` +
          `separation=${fStruct.separation.toFixed(2)} ` +
          `(adj=${fStruct.adjacentMeanDist.toFixed(2)} ` +
          `non=${fStruct.nonAdjacentMeanDist.toFixed(2)}, ` +
          `${fStruct.samplePairs} pairs)`
      );
      logger.log(
        `  random:     pearson=${fRand.pearson.toFixed(3)} ` +
          `separation=${fRand.separation.toFixed(2)}`
      );

      // Adjacent terms are closer than unrelated ones.
      assert.ok(
        fStruct.separation > 1.3,
        `structural separation ${fStruct.separation.toFixed(2)} should exceed 1.3`
      );
      // Manifold distance tracks graph distance.
      assert.ok(
        fStruct.pearson > 0.35,
        `structural pearson ${fStruct.pearson.toFixed(3)} should exceed 0.35`
      );
      // Structure clearly beats the null placement on both measures.
      assert.ok(
        fStruct.separation > fRand.separation * 1.3,
        `structural separation ${fStruct.separation.toFixed(2)} should clearly beat random ${fRand.separation.toFixed(2)}`
      );
      assert.ok(
        fStruct.pearson > fRand.pearson + 0.2,
        `structural pearson ${fStruct.pearson.toFixed(3)} should clearly beat random ${fRand.pearson.toFixed(3)}`
      );
    });

    await it("incremental anchored placement scales past the global cap, staying faithful", async () => {
      // A code-shaped graph (module chain, local refs) past any reasonable
      // global-SMACOF budget: the incremental placer (anchor skeleton + local
      // accretion + polish) must stay faithful and near-linear.
      seedRandom(7);
      const nNodes = 4000;
      const perModule = 40;
      const modules = Math.floor(nNodes / perModule);
      const nodes = [];
      const edges = [];
      for (let i = 0; i < nNodes; i++) {
        nodes.push({
          id: i,
          label: `sym_${i}`,
          kind: i < modules ? NodeKind.Module : NodeKind.Function,
          numeric: null,
        });
      }
      for (let m = 1; m < modules; m++) {
        edges.push({ from: m, to: m - 1, kind: EdgeKind.Reference, weight: 1 });
      }
      for (let i = modules; i < nNodes; i++) {
        const mod = (i - modules) % modules;
        edges.push({ from: mod, to: i, kind: EdgeKind.Containment, weight: 1 });
        const j =
          modules +
          mod +
          modules * Math.floor(random() * ((nNodes - modules) / modules - 1));
        if (j !== i && j < nNodes)
          edges.push({ from: i, to: j, kind: EdgeKind.Reference, weight: 1 });
      }
      const big: Grounding.GroundGraph = { nodes, edges };

      const t0 = performance.now();
      const placement = placeGraphIncremental(big, { seed: 0 });
      const elapsed = performance.now() - t0;
      const f = mapFidelity(big, placement);
      const fNull = mapFidelity(big, randomPlacement(big));
      logger.log(
        `  n=${nNodes}: placed in ${(elapsed / 1000).toFixed(2)}s ` +
          `pearson=${f.pearson.toFixed(3)} separation=${f.separation.toFixed(2)} ` +
          `(null ${fNull.pearson.toFixed(3)} / ${fNull.separation.toFixed(2)})`
      );
      assert.ok(
        f.pearson > 0.7,
        `incremental placement must stay faithful at scale (pearson ${f.pearson.toFixed(3)})`
      );
      assert.ok(
        f.separation > 3,
        `adjacent terms must stay metric-near (separation ${f.separation.toFixed(2)})`
      );
      assert.ok(
        f.pearson > fNull.pearson + 0.5,
        "incremental placement must crush the shuffled null"
      );
      assert.ok(
        elapsed < 20_000,
        `placement must be near-linear, not O(N²) (took ${(elapsed / 1000).toFixed(1)}s)`
      );
    });

    await it("is deterministic for a fixed seed", async () => {
      const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
        includeCallSites: true,
      });
      const g = buildGraphFromAstTriples(triples);
      const a = placeGraph(g, { seed: 42, iterations: 80 });
      const b = placeGraph(g, { seed: 42, iterations: 80 });
      for (let i = 0; i < g.nodes.length; i++) {
        assert.strictEqual(a.x[i], b.x[i], `posX[${i}] must be reproducible`);
      }
    });

    await it("unifies math: number line on W, reduction-linked terms near", async () => {
      // "1 + 2 = 3" and "5 + 2 = 7" as the same IR code/logic uses.
      const g: Grounding.GroundGraph = {
        nodes: [
          { id: 0, label: "expr_1_2", kind: NodeKind.Operator, numeric: null },
          { id: 1, label: "1", kind: NodeKind.Literal, numeric: 1 },
          { id: 2, label: "2", kind: NodeKind.Literal, numeric: 2 },
          { id: 3, label: "3", kind: NodeKind.Literal, numeric: 3 },
          { id: 4, label: "expr_5_2", kind: NodeKind.Operator, numeric: null },
          { id: 5, label: "5", kind: NodeKind.Literal, numeric: 5 },
          { id: 6, label: "7", kind: NodeKind.Literal, numeric: 7 },
        ],
        edges: [
          { from: 0, to: 1, kind: EdgeKind.Containment, weight: 1 },
          { from: 0, to: 2, kind: EdgeKind.Containment, weight: 1 },
          { from: 0, to: 3, kind: EdgeKind.Reduction, weight: 3 },
          { from: 4, to: 5, kind: EdgeKind.Containment, weight: 1 },
          { from: 4, to: 2, kind: EdgeKind.Containment, weight: 1 },
          { from: 4, to: 6, kind: EdgeKind.Reduction, weight: 3 },
        ],
      };
      const p = placeGraph(g, { seed: 0, iterations: 120 });

      // Number line: posW strictly orders literals by value.
      assert.ok(p.w[1] < p.w[2], "posW(1) < posW(2)");
      assert.ok(p.w[2] < p.w[3], "posW(2) < posW(3)");
      assert.ok(p.w[3] < p.w[6], "posW(3) < posW(7)");

      // Reduction-linked result sits nearer its expression than an unrelated
      // literal does (structure encodes the rewrite relation).
      const dist = (i: number, j: number) =>
        Math.hypot(
          p.x[i] - p.x[j],
          p.y[i] - p.y[j],
          p.z[i] - p.z[j],
          p.w[i] - p.w[j]
        );
      assert.ok(
        dist(0, 3) < dist(0, 6),
        "expr_1_2 should be nearer its result 3 than the unrelated result 7"
      );
    });

    await it("grounds a faithful map into the live System", async () => {
      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();

      const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
        includeCallSites: true,
      });
      const { graph, nodeToPrecept, placement } = groundAstIntoSystem(
        triples,
        system,
        atomizer,
        { seed: 0 }
      );
      assert.ok(placement, "graph is under the node cap, so it must be placed");

      // Every node became exactly one allocated, unique precept.
      const seen = new Set<number>();
      for (let i = 0; i < graph.nodes.length; i++) {
        const id = nodeToPrecept[i];
        assert.ok(
          id > 0 && system.isAllocated(id),
          `node ${i} should be an allocated precept`
        );
        assert.ok(!seen.has(id), `precept ${id} should be unique per node`);
        seen.add(id);
      }

      // Read coordinates back out of the LIVE System and measure fidelity there.
      const n = graph.nodes.length;
      const live: Grounding.Placement = {
        x: new Float64Array(n),
        y: new Float64Array(n),
        z: new Float64Array(n),
        w: new Float64Array(n),
        mass: new Float64Array(n),
      };
      for (let i = 0; i < n; i++) {
        const id = nodeToPrecept[i];
        live.x[i] = system.posX[id];
        live.y[i] = system.posY[id];
        live.z[i] = system.posZ[id];
        live.w[i] = system.posW[id];
        live.mass[i] = system.mass[id];
      }
      const f = mapFidelity(graph, live, { seed: 1 });
      logger.log(
        `  live System: pearson=${f.pearson.toFixed(3)} ` +
          `separation=${f.separation.toFixed(2)} over ${n} precepts`
      );
      assert.ok(
        f.pearson > 0.7,
        `live-System pearson ${f.pearson.toFixed(3)} should exceed 0.7`
      );
      assert.ok(
        f.separation > 1.5,
        `live-System separation ${f.separation.toFixed(2)} should exceed 1.5`
      );

      // "A function near its callees, not its name-twins": the single nearest
      // precept to `bootstrap` must be one of its actual graph neighbours.
      const bi = graph.nodes.findIndex(nd => nd.label === "bootstrap");
      assert.ok(bi >= 0, "bootstrap node should exist in the graph");
      const neighbours = new Set<number>();
      for (const e of graph.edges) {
        if (e.from === bi) neighbours.add(e.to);
        if (e.to === bi) neighbours.add(e.from);
      }
      const dist4 = (a: number, b: number) =>
        Math.hypot(
          live.x[a] - live.x[b],
          live.y[a] - live.y[b],
          live.z[a] - live.z[b],
          live.w[a] - live.w[b]
        );
      let nearest = -1;
      let nearestD = Number.POSITIVE_INFINITY;
      for (let j = 0; j < n; j++) {
        if (j === bi) continue;
        const d = dist4(bi, j);
        if (d < nearestD) {
          nearestD = d;
          nearest = j;
        }
      }
      assert.ok(
        neighbours.has(nearest),
        `bootstrap's nearest precept ("${graph.nodes[nearest]?.label}") should be a graph neighbour, ` +
          `not an unrelated term`
      );
    });

    await it("traversal of a faithful map tracks the graph geodesic, not a shuffled null", async () => {
      // The DYNAMIC fidelity claim: the geodesic the Traveler MOVES along must
      // respect the structure the map encodes (not just be statically near it).
      const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
        includeCallSites: true,
      });

      // Faithful, structure-grounded System.
      const sys = new System();
      const atom = new LogicAtomizer();
      await atom.init();
      const { graph, nodeToPrecept } = groundAstIntoSystem(triples, sys, atom, {
        seed: 0,
      });
      const traveler = new Traveler(sys);
      const fStruct = await traversalFidelity(
        graph,
        nodeToPrecept,
        (s, t) => traveler.traverse(s, t),
        { maxPairs: 32 }
      );

      // Shuffled-coordinate null: same precepts, random positions.
      seedRandom(0);
      const nullSys = new System();
      const nullAtom = new LogicAtomizer();
      await nullAtom.init();
      const { graph: g2, nodeToPrecept: n2p } = groundAstIntoSystem(
        triples,
        nullSys,
        nullAtom,
        { seed: 0 }
      );
      for (let i = 0; i < g2.nodes.length; i++) {
        const id = n2p[i];
        if (id < 0) continue;
        nullSys.posX[id] = (random() - 0.5) * 200;
        nullSys.posY[id] = (random() - 0.5) * 200;
        nullSys.posZ[id] = (random() - 0.5) * 200;
        nullSys.posW[id] = random() * 2;
        nullSys.update(id);
      }
      const nullTraveler = new Traveler(nullSys);
      const fNull = await traversalFidelity(
        g2,
        n2p,
        (s, t) => nullTraveler.traverse(s, t),
        { maxPairs: 32 }
      );

      logger.log(
        `  structural: onPath=${fStruct.onPathRate.toFixed(2)} ` +
          `monotonic=${fStruct.monotonicity.toFixed(2)} (${fStruct.pairs} pairs)`
      );
      logger.log(
        `  shuffled:   onPath=${fNull.onPathRate.toFixed(2)} ` +
          `monotonic=${fNull.monotonicity.toFixed(2)}`
      );

      // Interior path nodes lie on a graph shortest path far more often than
      // chance, and far more than the shuffled null (the clean discriminator).
      assert.ok(
        fStruct.onPathRate > 0.4,
        `structural onPath ${fStruct.onPathRate.toFixed(2)} should exceed 0.4`
      );
      assert.ok(
        fStruct.onPathRate > fNull.onPathRate * 2,
        `structural onPath ${fStruct.onPathRate.toFixed(2)} should clearly beat shuffled ${fNull.onPathRate.toFixed(2)}`
      );
      // The path moves toward the target along graph distance.
      assert.ok(
        fStruct.monotonicity > 0.6,
        `structural monotonicity ${fStruct.monotonicity.toFixed(2)} should exceed 0.6`
      );
    });

    await it("Phase 5: language inherits its referent's grounded posX, not GloVe", async () => {
      // Ground the corpus, then ingest a word that NAMES a grounded symbol. With
      // referent-grounding on, the language atom must land on the grounded precept
      // (the faithful map), not at the GloVe co-occurrence coordinate.
      const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
        includeCallSites: true,
      });

      const buildGrounded = async () => {
        const system = new System();
        const atomizer = new LogicAtomizer();
        await atomizer.init();
        const { graph, nodeToPrecept } = groundAstIntoSystem(
          triples,
          system,
          atomizer,
          { seed: 0 }
        );
        const bi = graph.nodes.findIndex(nd => nd.label === "bootstrap");
        assert.ok(bi >= 0, "bootstrap node should exist");
        const groundedX = system.posX[nodeToPrecept[bi]];
        return { system, atomizer, groundedX };
      };

      const original = DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED;
      try {
        // Referent ON: "bootstrap" snaps to the grounded precept's posX.
        DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = true;
        const on = await buildGrounded();
        const onIds = on.atomizer.ingestSequence("bootstrap", on.system);
        const onPosX = on.system.posX[onIds[onIds.length - 1]];
        assert.ok(
          Math.abs(onPosX - on.groundedX) < 1e-6,
          `referent-on posX ${onPosX.toFixed(4)} should equal grounded ${on.groundedX.toFixed(4)}`
        );

        // Referent OFF: the same word cold-starts to a DISTINCT GloVe coordinate -
        // proving the migration actually moves language off co-occurrence.
        DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = false;
        const off = await buildGrounded();
        const offIds = off.atomizer.ingestSequence("bootstrap", off.system);
        const offPosX = off.system.posX[offIds[offIds.length - 1]];
        assert.ok(
          Math.abs(offPosX - off.groundedX) > 1e-3,
          `GloVe posX ${offPosX.toFixed(4)} should differ from grounded ${off.groundedX.toFixed(4)}`
        );

        // Cold-start integrity: a word with NO referent falls back to GloVe
        // identically whether the flag is on or off (referent-grounding is
        // behaviour-preserving for novel terms).
        const novel = "zqxwvk";
        DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = true;
        const novelOnSys = await buildGrounded();
        const nOn =
          novelOnSys.system.posX[
            novelOnSys.atomizer.ingestSequence(novel, novelOnSys.system)[0]
          ];
        DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = false;
        const novelOffSys = await buildGrounded();
        const nOff =
          novelOffSys.system.posX[
            novelOffSys.atomizer.ingestSequence(novel, novelOffSys.system)[0]
          ];
        assert.ok(
          Math.abs(nOn - nOff) < 1e-9,
          `novel word should cold-start identically (${nOn} vs ${nOff})`
        );

        logger.log(
          `  bootstrap: referent posX=${onPosX.toFixed(3)} == grounded; ` +
            `GloVe posX=${offPosX.toFixed(3)} (gap ${Math.abs(offPosX - on.groundedX).toFixed(1)})`
        );
      } finally {
        DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = original;
      }
    });

    await it("Phase 5: a cold-start word grounds toward its co-occurring referents", async () => {
      // The referent channel only grounds a word that NAMES a grounded symbol.
      // This covers the cold start: a never-seen word uttered ALONGSIDE grounded
      // symbols must land in their neighbourhood (mean referent posX), not at its
      // GloVe coordinate. Requires referent-grounding; gated separately so an
      // isolated novel word still cold-starts to GloVe untouched.
      const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
        includeCallSites: true,
      });
      const buildGrounded = async () => {
        const system = new System();
        const atomizer = new LogicAtomizer();
        await atomizer.init();
        const { graph, nodeToPrecept } = groundAstIntoSystem(
          triples,
          system,
          atomizer,
          { seed: 0 }
        );
        const bi = graph.nodes.findIndex(nd => nd.label === "bootstrap");
        assert.ok(bi >= 0, "bootstrap node should exist");
        return { system, atomizer, groundedX: system.posX[nodeToPrecept[bi]] };
      };

      const origRef = DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED;
      const origCooc = DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED;
      const novel = "qzxvk0nope"; // never registered: no referent, no GloVe entry
      try {
        DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = true;

        // Co-occurrence ON: "<novel> bootstrap" lands the novel atom exactly on
        // bootstrap's grounded posX (its only grounded co-occurrent).
        DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED = true;
        const on = await buildGrounded();
        const onIds = on.atomizer.ingestSequence(
          `${novel} bootstrap`,
          on.system
        );
        const onNovelX = on.system.posX[onIds[0]];
        assert.ok(
          Math.abs(onNovelX - on.groundedX) < 1e-6,
          `cold-start novel posX ${onNovelX.toFixed(4)} should equal co-occurrent grounded ${on.groundedX.toFixed(4)}`
        );

        // Co-occurrence OFF: the same novel word cold-starts to its (distant)
        // GloVe coordinate instead - proving the grounding is what moved it.
        DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED = false;
        const off = await buildGrounded();
        const offIds = off.atomizer.ingestSequence(
          `${novel} bootstrap`,
          off.system
        );
        const offNovelX = off.system.posX[offIds[0]];
        assert.ok(
          Math.abs(offNovelX - off.groundedX) > 1e-3,
          `GloVe cold-start posX ${offNovelX.toFixed(4)} should differ from grounded ${off.groundedX.toFixed(4)}`
        );

        logger.log(
          `  cold-start "${novel}": co-occur posX=${onNovelX.toFixed(3)} == grounded; ` +
            `GloVe posX=${offNovelX.toFixed(3)} (gap ${Math.abs(offNovelX - on.groundedX).toFixed(1)})`
        );
      } finally {
        DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = origRef;
        DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED = origCooc;
      }
    });
  });

  // The unified-domain thesis: logic and math are the SAME typed graph as code,
  // so the SAME grounding + traversal machinery must be faithful on them too.
  await describe("LOGIC/MATH GROUNDING FIDELITY", async () => {
    const TAXONOMY = [
      "all dogs are mammals",
      "all cats are mammals",
      "all mammals are animals",
      "all birds are animals",
      "all animals are organisms",
      "all organisms are entities",
      "rex is a dog",
      "felix is a cat",
      "tweety is a bird",
    ];
    const ARITHMETIC = ["3 + 4 = 7", "1 + 2 = 3", "5 + 2 = 7", "6 - 2 = 4"];

    await it("parses logic + math into the unified IR with all three edge kinds", async () => {
      const logic = buildGraphFromLogic(TAXONOMY);
      const math = buildGraphFromLogic(ARITHMETIC);
      // Subsumption / membership are reference edges (the entailment backbone).
      assert.ok(logic.nodes.length >= 8, "taxonomy should span many terms");
      assert.ok(
        logic.edges.some(e => e.kind === EdgeKind.Reference),
        "taxonomy should yield reference edges"
      );
      // Arithmetic gives operator->operand containment and operator->result reduction.
      assert.ok(
        math.edges.some(e => e.kind === EdgeKind.Containment),
        "arithmetic should yield containment edges (operator -> operands)"
      );
      assert.ok(
        math.edges.some(e => e.kind === EdgeKind.Reduction),
        "arithmetic should yield reduction edges (operator -> result)"
      );
      logger.log(
        `  logic: ${logic.nodes.length} nodes / ${logic.edges.length} edges; ` +
          `math: ${math.nodes.length} nodes / ${math.edges.length} edges`
      );
    });

    await it("logic grounding is faithful (map + traversal), beating a shuffled null", async () => {
      const graph = buildGraphFromLogic(TAXONOMY);

      // Structure-grounded System.
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
      assert.ok(
        placement,
        "taxonomy is under the node cap, so it must be placed"
      );

      const fStatic = mapFidelity(graph, placement, { seed: 1 });
      const traveler = new Traveler(sys);
      const fStruct = await traversalFidelity(
        graph,
        nodeToPrecept,
        (s, t) => traveler.traverse(s, t),
        { maxPairs: 48 }
      );

      // Shuffled-coordinate null: same precepts + graph, random positions.
      seedRandom(0);
      const nullSys = new System();
      const nullAtom = new LogicAtomizer();
      await nullAtom.init();
      const { nodeToPrecept: n2p } = groundGraphIntoSystem(
        graph,
        nullSys,
        nullAtom,
        { seed: 0 }
      );
      const nullPlace: Grounding.Placement = {
        x: new Float64Array(graph.nodes.length),
        y: new Float64Array(graph.nodes.length),
        z: new Float64Array(graph.nodes.length),
        w: new Float64Array(graph.nodes.length),
        mass: new Float64Array(graph.nodes.length),
      };
      for (let i = 0; i < graph.nodes.length; i++) {
        const id = n2p[i];
        nullPlace.x[i] = (random() - 0.5) * 200;
        nullPlace.y[i] = (random() - 0.5) * 200;
        nullPlace.z[i] = (random() - 0.5) * 200;
        nullPlace.w[i] = random() * 2;
        if (id < 0) continue;
        nullSys.posX[id] = nullPlace.x[i];
        nullSys.posY[id] = nullPlace.y[i];
        nullSys.posZ[id] = nullPlace.z[i];
        nullSys.posW[id] = nullPlace.w[i];
        nullSys.update(id);
      }
      const fNullStatic = mapFidelity(graph, nullPlace, { seed: 1 });
      const nullTraveler = new Traveler(nullSys);
      const fNull = await traversalFidelity(
        graph,
        n2p,
        (s, t) => nullTraveler.traverse(s, t),
        { maxPairs: 48 }
      );

      logger.log(
        `  structural: pearson=${fStatic.pearson.toFixed(2)} sep=${fStatic.separation.toFixed(2)} ` +
          `onPath=${fStruct.onPathRate.toFixed(2)} mono=${fStruct.monotonicity.toFixed(2)} ` +
          `(${fStruct.pairs} pairs)`
      );
      logger.log(
        `  shuffled:   pearson=${fNullStatic.pearson.toFixed(2)} onPath=${fNull.onPathRate.toFixed(2)}`
      );

      // Static map is faithful and clearly beats the null.
      assert.ok(
        fStatic.pearson > 0.6,
        `logic static pearson ${fStatic.pearson.toFixed(2)} should exceed 0.6`
      );
      assert.ok(
        fStatic.pearson > fNullStatic.pearson + 0.2,
        `logic static pearson ${fStatic.pearson.toFixed(2)} should beat shuffled ${fNullStatic.pearson.toFixed(2)}`
      );
      // Traversal tracks the graph geodesic, far better than the shuffled null.
      assert.ok(
        fStruct.onPathRate > 0.4,
        `logic traversal onPath ${fStruct.onPathRate.toFixed(2)} should exceed 0.4`
      );
      assert.ok(
        fStruct.onPathRate > fNull.onPathRate * 2,
        `logic traversal onPath ${fStruct.onPathRate.toFixed(2)} should clearly beat shuffled ${fNull.onPathRate.toFixed(2)}`
      );
    });

    await it("stance: opposing precepts place on opposite halves of the Z axis", async () => {
      const STANCE_CORPUS = [
        "all cats are animals",
        "all fish are animals",
        "cats are not fish",
        "felix is a cat",
        "goldie is a fish",
      ];
      const graph = buildGraphFromLogic(STANCE_CORPUS);
      assert.ok(
        graph.contrasts && graph.contrasts.length >= 1,
        "the negated universal must yield a signed contrast pair"
      );

      const idOf = (label: string) =>
        graph.nodes.findIndex(nd => nd.label === label);
      const cat = idOf("cat");
      const fish = idOf("fish");
      const felix = idOf("felix");
      const goldie = idOf("goldie");
      const animal = idOf("animal");
      assert.ok(cat >= 0 && fish >= 0 && felix >= 0 && goldie >= 0);

      const withStance = placeGraph(graph, { seed: 0 });
      const without = placeGraph(
        { nodes: graph.nodes, edges: graph.edges },
        { seed: 0 }
      );

      const dzStance = withStance.z[cat] - withStance.z[fish];
      const dzPlain = without.z[cat] - without.z[fish];
      logger.log(
        `  Δz(cat,fish): with-stance=${dzStance.toFixed(2)} plain=${dzPlain.toFixed(2)}; ` +
          `felix follows cat (Δz=${(withStance.z[felix] - withStance.z[cat]).toFixed(2)}), ` +
          `animal sits near the saddle (z=${withStance.z[animal].toFixed(2)})`
      );

      // The opposing pair is pushed apart by the stance scale, far beyond the
      // plain layout (where "not" merely contributed no edge).
      assert.ok(
        Math.abs(dzStance) > Math.abs(dzPlain) + 4,
        `contrast pair must separate on Z (got ${Math.abs(dzStance).toFixed(2)} vs plain ${Math.abs(dzPlain).toFixed(2)})`
      );
      // Allies follow their camp: felix sides with cat, goldie with fish.
      const camp = Math.sign(withStance.z[cat] - withStance.z[fish]);
      assert.ok(
        Math.sign(withStance.z[felix] - withStance.z[goldie]) === camp,
        "instances must inherit their type's stance side"
      );
      // A node adjacent to BOTH camps stays between the poles - the saddle a
      // traveler must resolve with more evidence, rather than crowding noise.
      assert.ok(
        Math.abs(
          withStance.z[animal] - (withStance.z[cat] + withStance.z[fish]) / 2
        ) <
          Math.abs(dzStance) / 2,
        "the shared hypernym must sit between the opposing camps"
      );
    });
  });
}
