/**
 * Phase 4.5 - the survey loop (territory-corrected terrain).
 *
 * Exit criteria, both guarded here:
 *  (a) behaviouralFidelity - geometric predictions vs actual evaluation over
 *      expressions ingested WITHOUT their results; zero-mismatch where the
 *      embedding homomorphism is exact (the number line).
 *  (b) the repair demonstration - corrupt one node of a grounded terrain (a
 *      seeded mis-survey), show parse-relative fidelity stays blind (it IS
 *      faithful to the corrupted survey - the circularity), then show the loop
 *      detects the divergence, localizes it to the corrupted precept, repairs
 *      it with one local write, and re-validates.
 */

import assert from "node:assert";
import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import {
  behaviouralFidelity,
  localizeDivergences,
  surveyLoop,
} from "@core_s/grounding/BehaviouralFidelity";
import {
  closedWorldFidelity,
  closedWorldModel,
  closedWorldSurveyLoop,
  localizeClosedWorld,
} from "@core_s/grounding/ClosedWorldFidelity";
import {
  codeBehaviouralFidelity,
  codeSurveyLoop,
  executeExpressions,
} from "@core_s/grounding/CodeBehaviouralFidelity";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { placeGraph } from "@core_s/grounding/StructuralGrounding";
import {
  arithmeticFidelity,
  arithmeticSelfChannel,
} from "@core_s/grounding/SurveyLoopRunner";
import { EdgeKind, NodeKind } from "@core_s/helpers/enums";
import { NUMBER_LINE_SCALE } from "@skill_cogi/Reduction";
import logger from "@utils/SpectralLogger";
import { describe, it } from "./utils/harness";

const N = 11; // numerals 0..10

function surveyGraph(recorded: number[]): Grounding.GroundGraph {
  const nodes = recorded.map((v, i) => ({
    id: i,
    label: String(i),
    kind: NodeKind.Literal,
    numeric: v,
  }));
  const order = [...nodes].sort((a, b) => a.numeric! - b.numeric!);
  const edges = [];
  for (let i = 1; i < order.length; i++) {
    edges.push({
      from: order[i - 1].id,
      to: order[i].id,
      kind: EdgeKind.Reduction,
      weight: 1,
    });
  }
  return { nodes, edges };
}

function placeSurvey(recorded: number[]): Grounding.Placement {
  return {
    x: new Float64Array(N),
    y: new Float64Array(N),
    z: new Float64Array(N),
    w: Float64Array.from(recorded, v => v * NUMBER_LINE_SCALE),
    mass: new Float64Array(N).fill(1),
  };
}

export async function runSurveyLoopTests(): Promise<void> {
  await describe("PHASE 4.5 - SURVEY LOOP (TERRITORY-CORRECTED TERRAIN)", async () => {
    const system = new System();
    const atomizer = new LogicAtomizer();
    await atomizer.init();

    const ids: number[] = [];
    for (let n = 0; n < N; n++) {
      const scope = atomizer.getSymbolScope(String(n), false);
      const id = system.createLocation(system.c, scope);
      system.posW[id] = n * NUMBER_LINE_SCALE;
      system.decayRate[id] = 0;
      system.update(id);
      ids.push(id);
    }

    // Expressions only - their results are never ingested, so agreement with
    // evaluation cannot have been smuggled in by the parser.
    const exprs: string[] = [];
    for (let a = 0; a <= 10; a++) {
      for (let b = 0; b <= 10; b++) {
        if (a + b <= 10) exprs.push(`${a} + ${b}`);
        if (a - b >= 0) exprs.push(`${a} - ${b}`);
      }
    }

    await it("behavioural fidelity is 1.0 where the homomorphism is exact", async () => {
      const r = behaviouralFidelity(exprs, system, atomizer);
      logger.log(
        `  ${r.matched}/${r.total} geometric predictions match evaluation`
      );
      assert.ok(r.total > 100, "the corpus should be non-trivial");
      assert.strictEqual(
        r.fidelity,
        1,
        "the number line composes exactly - any mismatch is a terrain defect"
      );
    });

    // -- The seeded mis-survey ------------------------------------------------

    const recorded = Array.from({ length: N }, (_, i) => i);
    recorded[5] = 5.5; // the surveyor mis-read "5"
    const corruptW = 5.5 * NUMBER_LINE_SCALE;

    await it("parse-relative fidelity is BLIND to a faithful mis-survey", async () => {
      const parseRel = mapFidelity(
        surveyGraph(recorded),
        placeSurvey(recorded)
      );
      logger.log(
        `  corrupted survey scores pearson=${parseRel.pearson.toFixed(4)} ` +
          `separation=${parseRel.separation.toFixed(2)} - looks perfectly faithful`
      );
      assert.ok(
        parseRel.pearson > 0.95,
        "the placement IS faithful to the corrupted survey - that is the circularity"
      );
    });

    await it("the survey loop detects, localizes, repairs, and re-validates", async () => {
      system.posW[ids[5]] = corruptW;

      const broken = behaviouralFidelity(exprs, system, atomizer);
      assert.ok(
        broken.fidelity < 1,
        "behavioural fidelity must catch what parse-relative fidelity cannot"
      );
      assert.ok(
        broken.divergences.length > 0 &&
          broken.divergences.every(d => d.aVal === 5 || d.bVal === 5),
        "every divergence involves the corrupted numeral - errors have addresses"
      );

      const suspects = localizeDivergences(broken, system, atomizer);
      assert.strictEqual(
        suspects[0].label,
        "5",
        "the strongest suspect must be the corrupted precept"
      );
      assert.ok(
        Math.abs(suspects[0].suggestedW - 0.5) < 1e-9,
        "the divergences imply the territory's coordinate exactly"
      );

      const wOthersBefore = ids.map(id => system.posW[id]);
      const loop = surveyLoop(exprs, system, atomizer);
      logger.log(
        `  fidelity ${loop.before.fidelity.toFixed(3)} -> ${loop.after.fidelity.toFixed(3)} ` +
          `via ${loop.repairs.length} repair(s): ` +
          loop.repairs
            .map(
              r =>
                `"${r.label}" ${r.currentW.toFixed(3)}->${r.suggestedW.toFixed(3)}`
            )
            .join(", ")
      );

      assert.ok(loop.converged, "the loop must re-validate to fidelity 1.0");
      assert.strictEqual(loop.repairs.length, 1, "one defect, one repair");
      assert.strictEqual(loop.repairs[0].id, ids[5]);
      assert.ok(
        Math.abs(system.posW[ids[5]] - 0.5) < 1e-9,
        "the repaired precept sits where the territory says it belongs"
      );
      // Locality of writes: no other precept moved.
      for (let i = 0; i < N; i++) {
        if (i === 5) continue;
        assert.strictEqual(
          system.posW[ids[i]],
          wOthersBefore[i],
          `repair must not touch precept "${i}"`
        );
      }
    });
  });

  // -- Code channel: the territory is REAL EXECUTION (non-circular) ----------

  await describe("PHASE 4.5 - SURVEY LOOP, CODE CHANNEL (tsx EXECUTION)", async () => {
    const system = new System();
    const atomizer = new LogicAtomizer();
    await atomizer.init();

    const ids: number[] = [];
    for (let n = 0; n < N; n++) {
      const scope = atomizer.getSymbolScope(String(n), false);
      const id = system.createLocation(system.c, scope);
      system.posW[id] = n * NUMBER_LINE_SCALE;
      system.decayRate[id] = 0;
      system.update(id);
      ids.push(id);
    }

    const exprs: string[] = [];
    for (let a = 0; a <= 10; a++) {
      for (let b = 0; b <= 10; b++) {
        if (a + b <= 10) exprs.push(`${a} + ${b}`);
        if (a - b >= 0) exprs.push(`${a} - ${b}`);
      }
    }

    // One spawn: the territory's answers come from running the TypeScript, not
    // from arithmetic inside this process.
    const actuals = executeExpressions(exprs);

    await it("geometry predicts what the program RETURNS (fidelity 1.0, exact)", async () => {
      const r = codeBehaviouralFidelity(exprs, actuals, system, atomizer);
      logger.log(
        `  ${r.matched}/${r.total} predictions match the executed result`
      );
      assert.ok(r.total > 100, "the corpus should be non-trivial");
      assert.strictEqual(
        r.fidelity,
        1,
        "beta-reduction on the number line matches execution exactly"
      );
    });

    await it("a mis-survey diverges from execution, localizes, and repairs", async () => {
      system.posW[ids[5]] = 5.5 * NUMBER_LINE_SCALE;

      const broken = codeBehaviouralFidelity(exprs, actuals, system, atomizer);
      assert.ok(
        broken.fidelity < 1,
        "execution catches the coordinate defect the placer is blind to"
      );
      assert.ok(
        broken.divergences.every(d => d.aVal === 5 || d.bVal === 5),
        "every divergence involves the corrupted numeral - errors have addresses"
      );

      const wBefore = ids.map(id => system.posW[id]);
      const loop = codeSurveyLoop(exprs, system, atomizer, { actuals });
      logger.log(
        `  fidelity ${loop.before.fidelity.toFixed(3)} -> ${loop.after.fidelity.toFixed(3)} ` +
          `via ${loop.repairs.length} repair(s), truth from tsx`
      );
      assert.ok(
        loop.converged,
        "re-validates to fidelity 1.0 against execution"
      );
      assert.strictEqual(loop.repairs.length, 1, "one defect, one repair");
      assert.strictEqual(loop.repairs[0].id, ids[5]);
      assert.ok(Math.abs(system.posW[ids[5]] - 0.5) < 1e-9);
      for (let i = 0; i < N; i++) {
        if (i === 5) continue;
        assert.strictEqual(
          system.posW[ids[i]],
          wBefore[i],
          "locality of writes"
        );
      }
    });
  });

  // -- Closed-world logic: the approximate-homomorphism case (re-placement) --

  await describe("PHASE 4.5 - SURVEY LOOP, CLOSED-WORLD LOGIC (GRAPH DOMAIN)", async () => {
    const TRUE_KB = [
      "felix is a cat",
      "tom is a cat",
      "garfield is a cat",
      "cats are mammals",
      "rex is a dog",
      "fido is a dog",
      "dogs are mammals",
      "mammals are animals",
      "nemo is a fish",
      "goldie is a fish",
      "bubbles is a fish",
      "fish are animals",
      "robin is a bird",
      "tweety is a bird",
      "birds are animals",
    ];
    const SURVEY_KB = TRUE_KB.map(s =>
      s === "nemo is a fish" ? "nemo is a cat" : s
    );
    const gTrue = buildGraphFromLogic(TRUE_KB);
    const gSurvey = buildGraphFromLogic(SURVEY_KB);
    const labelIndex = (label: string) =>
      gTrue.nodes.findIndex(nd => nd.label === label);

    const pTrue = placeGraph(gTrue, { seed: 1 });
    const model = closedWorldModel(gTrue);
    const baseline = closedWorldFidelity(gTrue, pTrue, model);

    await it("a faithful taxonomy recovers its closed-world consequences", async () => {
      logger.log(
        `  closed-world fidelity ${baseline.matched}/${baseline.total} = ${baseline.fidelity.toFixed(3)}`
      );
      // Approximate homomorphism: high, not 1.0 - the honest graph-domain number.
      assert.ok(
        baseline.fidelity > 0.6,
        "nearest-k recovers most consequences of a faithful map"
      );
    });

    await it("graph-domain mis-survey: blind to parse-relative, caught by the model", async () => {
      // Mis-file nemo into the cat region of the true layout (one node out of
      // place, faithful to the corrupted survey).
      const p: Grounding.Placement = {
        x: Float64Array.from(pTrue.x),
        y: Float64Array.from(pTrue.y),
        z: Float64Array.from(pTrue.z),
        w: Float64Array.from(pTrue.w),
        mass: Float64Array.from(pTrue.mass),
      };
      const nemo = labelIndex("nemo");
      const cat = labelIndex("cat");
      p.x[nemo] = pTrue.x[cat] + 0.01;
      p.y[nemo] = pTrue.y[cat] - 0.01;
      p.z[nemo] = pTrue.z[cat] + 0.01;

      const parseRel = mapFidelity(gSurvey, p);
      logger.log(
        `  parse-relative pearson=${parseRel.pearson.toFixed(3)} (blind to the defect)`
      );
      assert.ok(
        parseRel.pearson > 0.8,
        "the placement is faithful to the corrupted survey - the circularity"
      );

      const broken = closedWorldFidelity(gTrue, p, model);
      assert.ok(
        broken.fidelity < baseline.fidelity,
        "the TRUE model exposes what parse-relative fidelity cannot"
      );
      assert.ok(
        broken.divergences.some(d => d.srcLabel === "nemo"),
        "nemo's true consequences are not recovered - errors have addresses"
      );

      const suspects = localizeClosedWorld(broken, gTrue, p);
      assert.strictEqual(
        suspects[0].label,
        "nemo",
        "the most stressed implicated node is the mis-placed one"
      );

      // The repair is RE-PLACEMENT (SMACOF over the neighbourhood), not the
      // coordinate-solving the exact number-line domain admits.
      const moved0 = gTrue.nodes.map((_, i) => [p.x[i], p.y[i], p.z[i]]);
      const loop = closedWorldSurveyLoop(gTrue, p, { model });
      logger.log(
        `  fidelity ${loop.before.fidelity.toFixed(3)} -> ${loop.after.fidelity.toFixed(3)} ` +
          `via ${loop.repairs.length} re-placement(s)`
      );
      assert.ok(loop.converged, "the loop resolves the detectable defect");
      assert.strictEqual(
        loop.repairs.length,
        1,
        "one defect, one re-placement"
      );
      assert.strictEqual(loop.repairs[0].label, "nemo");
      assert.ok(
        loop.after.fidelity >= baseline.fidelity - 1e-9,
        "re-placement restores the faithful baseline"
      );
      // Locality of writes: only nemo's coordinate moved.
      let moved = 0;
      for (let i = 0; i < gTrue.nodes.length; i++) {
        const [x, y, z] = moved0[i];
        if (p.x[i] !== x || p.y[i] !== y || p.z[i] !== z) moved++;
      }
      assert.strictEqual(moved, 1, "re-placement touched exactly one node");
    });
  });

  // -- The loop WIRED into the live Traveler (territory-correction tick) ------

  await describe("PHASE 4.5 - SURVEY LOOP WIRED (runSurveyLoopTick)", async () => {
    const system = new System();
    const atomizer = new LogicAtomizer();
    await atomizer.init();

    const numerals = new Map<number, number>();
    for (let n = 0; n < N; n++) {
      const scope = atomizer.getSymbolScope(String(n), false);
      const id = system.createLocation(system.c, scope);
      system.posW[id] = n * NUMBER_LINE_SCALE;
      system.decayRate[id] = 0;
      system.update(id);
      numerals.set(n, id);
    }
    const traveler = new Traveler(system, atomizer);
    traveler.surveyChannels = [arithmeticSelfChannel({ numerals })];

    await it("the wired tick repairs several simultaneous drifts at once", async () => {
      // Three numerals drift past the snap boundary at the same time - the
      // multi-fault case a single-fault localizer cannot resolve.
      for (const v of [4, 7, 9]) {
        system.posW[numerals.get(v)!] = (v + 0.6) * NUMBER_LINE_SCALE;
      }
      const before = arithmeticFidelity(system, atomizer, numerals);
      assert.ok(before < 1, "three drifts must drop behavioural fidelity");

      const report = traveler.runSurveyLoopTick();
      const after = arithmeticFidelity(system, atomizer, numerals);
      logger.log(
        `  wired tick: ${report.totalRepairs} repair(s), fidelity ` +
          `${before.toFixed(3)} -> ${after.toFixed(3)}`
      );
      assert.strictEqual(after, 1, "the tick restores the whole number line");
      assert.ok(
        report.totalRepairs >= 3,
        "all three drifts repaired in one tick"
      );
      for (const v of [4, 7, 9]) {
        assert.ok(
          Math.abs(system.posW[numerals.get(v)!] - v * NUMBER_LINE_SCALE) <
            1e-9,
          `numeral ${v} is back on its lattice point`
        );
      }
    });

    await it("a clean number line is inert (no needless repairs)", async () => {
      const report = traveler.runSurveyLoopTick();
      assert.strictEqual(
        report.totalRepairs,
        0,
        "nothing to correct when the terrain already matches the territory"
      );
    });
  });
}
