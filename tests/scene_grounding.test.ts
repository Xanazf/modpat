/**
 * Scene-graph grounding suite (Phase 6 first increment; ROADMAP step #8).
 *
 * The unified-domain thesis says a scene is just another typed graph over terms.
 * This guards that a scene (objects + containment + spatial relations +
 * coreference) parses into the SAME GroundGraph IR with all three edge kinds and
 * grounds FAITHFULLY under the SAME machinery as code and logic/math - map +
 * traversal fidelity beating a shuffled-coordinate null - with no camera
 * pipeline, just the `SceneGraph` parser and the `SceneAtomizer` object↔word map.
 */

import * as assert from "node:assert";
import SceneAtomizer from "@atomics/SceneAtomizer";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundGraphIntoSystem } from "@core_s/grounding/AstGrounding";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { buildGraphFromScene } from "@core_s/grounding/SceneGraph";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { EdgeKind } from "@core_s/helpers/enums";
import logger from "@utils/SpectralLogger";
import { random, seedRandom } from "@utils/seededRandom";
import { describe, it } from "./utils/harness";

const SCENE = [
  "room contains table", // containment
  "room contains shelf", // containment
  "table holds plate", // containment
  "cup on table", // spatial reference
  "plate near cup", // spatial reference
  "lamp on shelf", // spatial reference
  "mug same as cup", // coreference (reduction)
];

export async function runSceneGroundingTests() {
  await describe("SCENE GRAPH GROUNDING FIDELITY", async () => {
    await it("parses a scene into the unified IR with all three edge kinds", async () => {
      const g = buildGraphFromScene(SCENE);
      assert.ok(g.nodes.length >= 7, "scene should span its objects");
      assert.ok(
        g.edges.some(e => e.kind === EdgeKind.Containment),
        "containment edges (region -> object)"
      );
      assert.ok(
        g.edges.some(e => e.kind === EdgeKind.Reference),
        "reference edges (spatial relation)"
      );
      assert.ok(
        g.edges.some(e => e.kind === EdgeKind.Reduction),
        "reduction edges (coreference / identity)"
      );
      logger.log(`  scene: ${g.nodes.length} nodes / ${g.edges.length} edges`);
    });

    await it("containment points region -> object; identity is a reduction edge", async () => {
      const g = buildGraphFromScene(SCENE);
      const idOf = (label: string) =>
        g.nodes.find(n => n.label === label)?.id ?? -1;
      const room = idOf("room");
      const table = idOf("table");
      const contains = g.edges.find(
        e =>
          e.from === room && e.to === table && e.kind === EdgeKind.Containment
      );
      assert.ok(contains, "'room contains table' ⇒ Containment room -> table");

      const cup = idOf("cup");
      const mug = idOf("mug");
      const ident = g.edges.find(
        e =>
          ((e.from === mug && e.to === cup) ||
            (e.from === cup && e.to === mug)) &&
          e.kind === EdgeKind.Reduction
      );
      assert.ok(ident, "'mug same as cup' ⇒ Reduction between mug and cup");
    });

    await it("SceneAtomizer is a clean object↔word map", async () => {
      const atom = new SceneAtomizer();
      await atom.init();
      // Multi-word object stays ONE body and round-trips verbatim.
      const redBall = atom.getSymbolScope("red ball");
      assert.strictEqual(atom.resolveScope(redBall), "red ball");
      // Case-insensitive identity.
      assert.strictEqual(atom.getSymbolScope("Red Ball"), redBall);
      // Distinct objects get distinct scopes (no collapsing).
      assert.notStrictEqual(atom.getSymbolScope("ball"), redBall);
      // No operator/arithmetic canonicalisation: "plus" stays "plus", unlike the
      // logic/language atomizers that would rewrite it to "+".
      const plus = atom.getSymbolScope("plus");
      assert.strictEqual(atom.resolveScope(plus), "plus");
    });

    await it("scene grounding is faithful (map + traversal), beating a shuffled null", async () => {
      const graph = buildGraphFromScene(SCENE);

      seedRandom(0);
      const sys = new System();
      const atom = new SceneAtomizer();
      await atom.init();
      const { nodeToPrecept, placement } = groundGraphIntoSystem(
        graph,
        sys,
        atom,
        { seed: 0 }
      );
      assert.ok(placement, "scene is under the node cap, so it must be placed");

      const fStatic = mapFidelity(graph, placement, { seed: 1 });
      const traveler = new Traveler(sys);
      const fStruct = await traversalFidelity(
        graph,
        nodeToPrecept,
        (s, t) => traveler.traverse(s, t),
        { maxPairs: 48 }
      );

      // Shuffled-coordinate null.
      seedRandom(0);
      const nullSys = new System();
      const nullAtom = new SceneAtomizer();
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

      logger.log(
        `  structural: pearson=${fStatic.pearson.toFixed(2)} sep=${fStatic.separation.toFixed(2)} ` +
          `onPath=${fStruct.onPathRate.toFixed(2)} mono=${fStruct.monotonicity.toFixed(2)} (${fStruct.pairs} pairs)`
      );
      logger.log(`  shuffled:   pearson=${fNullStatic.pearson.toFixed(2)}`);

      assert.ok(
        fStatic.pearson > 0.6,
        `scene static pearson ${fStatic.pearson.toFixed(2)} should exceed 0.6`
      );
      assert.ok(
        fStatic.pearson > fNullStatic.pearson + 0.2,
        `scene static pearson ${fStatic.pearson.toFixed(2)} should beat shuffled ${fNullStatic.pearson.toFixed(2)}`
      );
      assert.ok(
        fStruct.onPathRate > 0.4,
        `scene traversal onPath ${fStruct.onPathRate.toFixed(2)} should exceed 0.4`
      );
    });
  });
}
