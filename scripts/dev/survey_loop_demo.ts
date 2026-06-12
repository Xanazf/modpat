/**
 * Phase 4.5 - the survey loop, demonstrated end to end (arithmetic increment).
 *
 * 1. Ground the number line 0..10 (a faithful survey). Behavioural fidelity
 *    (geometry-predicted reducts vs actual evaluation, over expressions whose
 *    results were never ingested) is 1.0 - the homomorphism is exact.
 * 2. Seed a mis-survey: the surveyor recorded "5" at 5.5. The placement is
 *    PERFECTLY faithful to that corrupted survey - parse-relative fidelity
 *    (mapFidelity pearson + per-node survey agreement) cannot see anything
 *    wrong. That is the circularity, made visible.
 * 3. Run the loop: predictions diverge from evaluation exactly on the
 *    expressions touching "5"; the divergences all imply the SAME corrected
 *    coordinate (errors have addresses); one local re-placement repairs it.
 * 4. Re-validate: behavioural fidelity returns to 1.0 - and the repaired map
 *    now DISAGREES with the corrupted survey at exactly one node. The map
 *    answers for something outside itself.
 *
 * Run: tsx scripts/dev/survey_loop_demo.ts
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import {
  behaviouralFidelity,
  localizeDivergences,
  surveyLoop,
} from "@core_s/grounding/BehaviouralFidelity";
import { EdgeKind, NodeKind } from "@core_s/grounding/GroundGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { NUMBER_LINE_SCALE } from "@skill_cogi/Reduction";

const N = 11; // numerals 0..10

/** The survey: recorded value per numeral (the mis-survey corrupts ONE). */
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

/** Placement faithful to the survey: posW = recorded value × scale. */
function placeSurvey(recorded: number[]): Grounding.Placement {
  return {
    x: new Float64Array(N),
    y: new Float64Array(N),
    z: new Float64Array(N),
    w: Float64Array.from(recorded, v => v * NUMBER_LINE_SCALE),
    mass: new Float64Array(N).fill(1),
  };
}

/** Fraction of nodes whose placement agrees with the survey's record. */
function surveyAgreement(recorded: number[], w: Float64Array): number {
  let agree = 0;
  for (let i = 0; i < N; i++) {
    if (Math.abs(w[i] - recorded[i] * NUMBER_LINE_SCALE) < 1e-9) agree++;
  }
  return agree / N;
}

async function run(): Promise<void> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();

  // Ground numerals 0..10; expressions never carry their results.
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

  console.log("=== 1. faithful survey ===");
  const clean = behaviouralFidelity(exprs, system, atomizer);
  console.log(
    `behavioural fidelity ${clean.matched}/${clean.total} = ${clean.fidelity.toFixed(3)} ` +
      `(exact homomorphism: zero mismatch expected)`
  );

  console.log("\n=== 2. seeded mis-survey: '5' recorded at 5.5 ===");
  const recorded = Array.from({ length: N }, (_, i) => i);
  recorded[5] = 5.5;
  system.posW[ids[5]] = 5.5 * NUMBER_LINE_SCALE; // placement faithful to it

  const g = surveyGraph(recorded);
  const p = placeSurvey(recorded);
  const parseRel = mapFidelity(g, p);
  console.log(
    `parse-relative fidelity vs the CORRUPTED survey: pearson=${parseRel.pearson.toFixed(4)} ` +
      `separation=${parseRel.separation.toFixed(2)} survey-agreement=${(surveyAgreement(recorded, p.w) * 100).toFixed(0)}%`
  );
  console.log(
    "  -> the corrupted terrain scores as perfectly faithful (blind)."
  );

  const broken = behaviouralFidelity(exprs, system, atomizer);
  console.log(
    `behavioural fidelity: ${broken.matched}/${broken.total} = ${broken.fidelity.toFixed(3)} ` +
      `(${broken.divergences.length} divergences, each with an address)`
  );
  const sample = broken.divergences.slice(0, 3);
  for (const d of sample) {
    console.log(
      `  "${d.expr}" predicted=${d.predicted} actual=${d.actual} ` +
        `addresses=[${d.aId}, ${d.bId}]`
    );
  }

  console.log("\n=== 3. localization ===");
  const suspects = localizeDivergences(broken, system, atomizer).slice(0, 3);
  for (const s of suspects) {
    console.log(
      `  suspect "${s.label}" (precept ${s.id}): fails=${s.failCount} passes=${s.passCount} ` +
        `spread=${s.spread.toFixed(3)} currentW=${s.currentW.toFixed(3)} -> suggestedW=${s.suggestedW.toFixed(3)}`
    );
  }

  console.log("\n=== 4. repair + re-validate ===");
  const loop = surveyLoop(exprs, system, atomizer);
  for (const r of loop.repairs) {
    console.log(
      `  repaired "${r.label}": posW ${r.currentW.toFixed(3)} -> ${r.suggestedW.toFixed(3)} (one local write)`
    );
  }
  console.log(
    `behavioural fidelity after: ${loop.after.matched}/${loop.after.total} = ${loop.after.fidelity.toFixed(3)} ` +
      `converged=${loop.converged}`
  );

  // The punchline: the repaired map now disagrees with the corrupted survey.
  const wAfter = Float64Array.from(ids, id => system.posW[id]);
  console.log(
    `survey-agreement with the corrupted survey after repair: ` +
      `${(surveyAgreement(recorded, wAfter) * 100).toFixed(0)}% ` +
      `(the map broke with its own survey to agree with the territory)`
  );
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
