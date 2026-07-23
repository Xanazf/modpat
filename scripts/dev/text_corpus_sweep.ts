/**
 * Text corpus sweep - proves the ISOLATED grammar-grounding mechanism
 * (TextGraph parse -> placement -> traversal) on naturalistic English before
 * anything touches the live Language path. Mirror of logic_math_corpus_sweep
 * with buildGraphFromText and naturalistic corpora (including RuleTaker /
 * ProofWriter hop-1 surface forms from the external benchmark families).
 *
 * Also prints the placement's pairwise-distance distribution against
 * INFLUENCE_RADIUS - the measured input for TEXT_GRAPH_SPATIAL_SCALE
 * calibration (config.ts).
 *
 * Run: tsx scripts/dev/text_corpus_sweep.ts
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundGraphIntoSystem } from "@core_s/grounding/AstGrounding";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { buildGraphFromText } from "@core_s/grounding/TextGraph";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { random, seedRandom } from "@utils/seededRandom";

const CORPORA: Array<{ name: string; statements: string[] }> = [
  {
    // RuleTaker-style hop-1 naturalistic surface (the 0.60 family).
    name: "ruletaker hop-1",
    statements: [
      "cats are mammals",
      "felix is a cat",
      "all dogs bark",
      "rex is a dog",
      "the sky is blue",
      "water boils at one hundred degrees",
      "anne is big",
      "red things are round",
      "anne is red",
    ],
  },
  {
    // ProofWriter-style chains as full English.
    name: "proofwriter chains",
    statements: [
      "socrates is a man",
      "all men are mortal",
      "if it rains then the ground is wet",
      "all birds have wings",
      "tweety is a bird",
      "the dog chased the cat",
      "the cat ran away",
    ],
  },
  {
    name: "naturalized syllogism",
    statements: [
      "dogs are mammals",
      "cats are mammals",
      "mammals are animals",
      "birds are animals",
      "animals are organisms",
      "organisms are entities",
      "rex is a dog",
      "felix is a cat",
      "tweety is a bird",
    ],
  },
  {
    name: "naturalized implication",
    statements: [
      "if the sun shines then the air warms",
      "if the air warms then the ice melts",
      "if the ice melts then the river rises",
      "if the river rises then the valley floods",
    ],
  },
  {
    name: "mixed register",
    statements: [
      "penguins cannot fly",
      "penguins are birds",
      "birds have feathers",
      "the storm damaged the roof and the rain soaked the walls",
      "iron conducts electricity",
      "iron is a metal",
      "steam rises because water boils",
    ],
  },
];

function shufflePlacement(n: number): Grounding.Placement {
  const p: Grounding.Placement = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    p.x[i] = (random() - 0.5) * 200;
    p.y[i] = (random() - 0.5) * 200;
    p.z[i] = (random() - 0.5) * 200;
    p.w[i] = random() * 2;
    p.mass[i] = 1;
  }
  return p;
}

/** Pairwise XYZ distance percentiles - the scale-calibration readout. */
function distanceDistribution(p: Grounding.Placement): {
  p10: number;
  p50: number;
  p90: number;
  max: number;
} {
  const n = p.x.length;
  const dists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      dists.push(
        Math.hypot(p.x[i] - p.x[j], p.y[i] - p.y[j], p.z[i] - p.z[j])
      );
    }
  }
  dists.sort((a, b) => a - b);
  const at = (q: number) => dists[Math.floor(q * (dists.length - 1))] ?? 0;
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9), max: at(1) };
}

async function scoreCorpus(
  name: string,
  statements: string[]
): Promise<boolean> {
  const graph = buildGraphFromText(statements);
  if (graph.nodes.length < 4 || graph.edges.length < 3) {
    console.log(`  ${name.padEnd(24)} SKIP (graph too small)`);
    return false;
  }

  seedRandom(0);
  const sys = new System();
  const atom = new LogicAtomizer();
  await atom.init();
  const { nodeToPrecept, placement } = groundGraphIntoSystem(graph, sys, atom, {
    seed: 0,
  });
  if (!placement) return false;

  const fStatic = mapFidelity(graph, placement, { seed: 1 });
  const fNull = mapFidelity(graph, shufflePlacement(graph.nodes.length), {
    seed: 1,
  });

  const traveler = new Traveler(sys);
  const fDyn = await traversalFidelity(
    graph,
    nodeToPrecept,
    (s, t) => traveler.traverse(s, t),
    { maxPairs: 48 }
  );

  const dd = distanceDistribution(placement);
  const pass =
    fStatic.pearson > fNull.pearson + 0.2 &&
    fStatic.separation > fNull.separation * 1.3 &&
    fDyn.onPathRate > 0.4;

  console.log(
    `  ${name.padEnd(24)} n=${String(graph.nodes.length).padStart(2)} e=${String(graph.edges.length).padStart(2)} ` +
      `static[pearson=${fStatic.pearson.toFixed(2)} sep=${fStatic.separation.toFixed(2)} vs null ${fNull.pearson.toFixed(2)}] ` +
      `dyn[onPath=${fDyn.onPathRate.toFixed(2)} pairs=${fDyn.pairs}] ` +
      `dist[p10=${dd.p10.toFixed(1)} p50=${dd.p50.toFixed(1)} p90=${dd.p90.toFixed(1)}] ` +
      (pass ? "PASS" : "----")
  );
  return pass;
}

async function main(): Promise<void> {
  console.log(
    `\nText corpus sweep (INFLUENCE_RADIUS=${DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS}, ` +
      `TEXT_GRAPH_SPATIAL_SCALE=${DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_SPATIAL_SCALE})\n`
  );
  let passes = 0;
  for (const c of CORPORA) {
    if (await scoreCorpus(c.name, c.statements)) passes++;
  }
  console.log(`\n  ${passes}/${CORPORA.length} corpora PASS\n`);
}

const invokedDirectly =
  process.argv[1]?.endsWith("text_corpus_sweep.ts") ?? false;
if (invokedDirectly) {
  main()
    .catch(err => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => process.exit(0));
}
