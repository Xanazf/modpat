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
import {
  behaviouralFidelity,
  localizeDivergences,
  surveyLoop,
} from "@core_s/grounding/BehaviouralFidelity";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
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
}
