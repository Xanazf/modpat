/**
 * Phase 4.5 - the survey loop's CLOSED-WORLD LOGIC channel + the graph-domain
 * corruption variant of the repair demo (reviewer prediction 1's load-bearing
 * half: the approximate-homomorphism case repairs by RE-PLACEMENT, not by
 * coordinate-solving).
 *
 *   1. Ground a taxonomy KB faithfully. The territory is the KB's closed-world
 *      model (transitive consequences of its IS / subsumption edges); the
 *      geometry predicts each term's consequences as its nearest neighbours.
 *      Baseline closed-world fidelity is high (an approximate embedding, so not
 *      necessarily 1.0 - the honest graph-domain number).
 *   2. Seed a mis-survey: the KB recorded ONE membership wrong ("nemo is a cat"
 *      instead of "nemo is a fish") and was placed FAITHFULLY to that record.
 *      Parse-relative fidelity (mapFidelity vs the corrupted survey) is BLIND -
 *      the placement IS faithful to the survey. The closed-world model of the
 *      TRUE KB is not: nemo sits far from the consequences it really has.
 *   3. The loop localizes the divergences to "nemo", RE-PLACES it against its
 *      true neighbourhood (one node's coordinate moves; there is no implied
 *      coordinate to solve - that is the graph-domain repair), and re-validates.
 *
 * Run: tsx scripts/dev/closed_world_survey_loop_demo.ts
 */

import {
  closedWorldFidelity,
  closedWorldModel,
  closedWorldSurveyLoop,
  localizeClosedWorld,
} from "@core_s/grounding/ClosedWorldFidelity";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { placeGraph } from "@core_s/grounding/StructuralGrounding";

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

// The surveyor mis-filed nemo: recorded "nemo is a cat".
const SURVEY_KB = TRUE_KB.map(s =>
  s === "nemo is a fish" ? "nemo is a cat" : s
);

function labelIndex(g: Grounding.GroundGraph, label: string): number {
  return g.nodes.findIndex(nd => nd.label === label);
}

function run(): void {
  const gTrue = buildGraphFromLogic(TRUE_KB);
  const gSurvey = buildGraphFromLogic(SURVEY_KB);

  console.log("=== 1. faithful survey ===");
  const pTrue = placeGraph(gTrue, { seed: 1 });
  const model = closedWorldModel(gTrue);
  const baseline = closedWorldFidelity(gTrue, pTrue, model);
  console.log(
    `closed-world fidelity ${baseline.matched}/${baseline.total} = ${baseline.fidelity.toFixed(3)} ` +
      `(geometry's nearest-k vs the KB's closed-world consequences)`
  );

  console.log("\n=== 2. seeded mis-survey: 'nemo is a cat' ===");
  // The surveyor filed nemo under cat, so the placer dropped it in the cat
  // region - faithful to the corrupted survey, one node out of place. Mutating a
  // single coordinate of the TRUE layout isolates the defect to nemo so the
  // delta is purely its own (vs. re-running SMACOF on the survey graph, which
  // would also re-gauge every other node).
  const pSurvey: Grounding.Placement = {
    x: Float64Array.from(pTrue.x),
    y: Float64Array.from(pTrue.y),
    z: Float64Array.from(pTrue.z),
    w: Float64Array.from(pTrue.w),
    mass: Float64Array.from(pTrue.mass),
  };
  const nemo = labelIndex(gTrue, "nemo");
  const cat = labelIndex(gTrue, "cat");
  pSurvey.x[nemo] = pTrue.x[cat] + 0.01;
  pSurvey.y[nemo] = pTrue.y[cat] - 0.01;
  pSurvey.z[nemo] = pTrue.z[cat] + 0.01;

  const parseRel = mapFidelity(gSurvey, pSurvey);
  console.log(
    `parse-relative fidelity vs the CORRUPTED survey: pearson=${parseRel.pearson.toFixed(4)} ` +
      `separation=${parseRel.separation.toFixed(2)} - looks perfectly faithful (blind)`
  );
  const broken = closedWorldFidelity(gTrue, pSurvey, model);
  console.log(
    `closed-world fidelity vs the TRUE model: ${broken.matched}/${broken.total} = ` +
      `${broken.fidelity.toFixed(3)} (${broken.divergences.length} divergences, with addresses)`
  );
  for (const d of broken.divergences.slice(0, 6)) {
    console.log(`  "${d.srcLabel}" |- "${d.targetLabel}" not recovered`);
  }

  console.log("\n=== 3. localization ===");
  for (const s of localizeClosedWorld(broken, gTrue, pSurvey).slice(0, 4)) {
    console.log(
      `  suspect "${s.label}" (node ${s.id}): stress=${s.stress.toFixed(3)} ` +
        `fails=${s.failCount} passes=${s.passCount}`
    );
  }

  console.log("\n=== 4. re-placement repair + re-validate ===");
  const xyzBefore = gTrue.nodes.map((_, i) => [
    pSurvey.x[i],
    pSurvey.y[i],
    pSurvey.z[i],
  ]);
  const loop = closedWorldSurveyLoop(gTrue, pSurvey, { model });
  for (const r of loop.repairs) {
    console.log(
      `  re-placed "${r.label}" (node ${r.id}) against its true neighbourhood`
    );
  }
  console.log(
    `closed-world fidelity after: ${loop.after.matched}/${loop.after.total} = ` +
      `${loop.after.fidelity.toFixed(3)} converged=${loop.converged}`
  );
  // Locality of writes: count nodes whose coordinate moved.
  let moved = 0;
  for (let i = 0; i < gTrue.nodes.length; i++) {
    const [x, y, z] = xyzBefore[i];
    if (pSurvey.x[i] !== x || pSurvey.y[i] !== y || pSurvey.z[i] !== z) moved++;
  }
  console.log(`  nodes moved by the repair: ${moved} (locality of writes)`);
}

run();
