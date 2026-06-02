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
import {
  buildGraphFromAstTriples,
  EdgeKind,
  type GroundGraph,
  NodeKind,
} from "@core_s/grounding/GroundGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import {
  placeGraph,
  type Placement,
  randomPlacement,
} from "@core_s/grounding/StructuralGrounding";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { extractAstTriples } from "@utils/astExtract";
import { random, seedRandom } from "@utils/seededRandom";
import logger from "@utils/SpectralLogger";
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
      const g: GroundGraph = {
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
      const live: Placement = {
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
  });
}
