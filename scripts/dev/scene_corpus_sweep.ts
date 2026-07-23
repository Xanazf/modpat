/**
 * Scene-graph cross-corpus fidelity sweep (Phase 6 first increment; ROADMAP #8).
 * Run: tsx scripts/dev/scene_corpus_sweep.ts
 *
 * The logic/math sweep proved a second domain lands through the SAME GroundGraph
 * IR with no new grounding machinery. Vision's first increment is just another
 * parser - a scene (objects, containment, spatial relations) into the same three
 * edge kinds - scored by the SAME mapFidelity / traversalFidelity vs a shuffled
 * null, before any camera pipeline exists.
 *
 *   static  : mapFidelity(graph, structural placement)  vs  shuffled placement
 *   dynamic : traversalFidelity(traverse)               vs  shuffled-coordinate null
 *
 * A corpus PASSES when the structural map is faithful (pearson up, separation up)
 * AND the traversal tracks the graph geodesic far better than the shuffled null.
 */

import SceneAtomizer from "@atomics/SceneAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundGraphIntoSystem } from "@core_s/grounding/AstGrounding";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { buildGraphFromScene } from "@core_s/grounding/SceneGraph";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { random, seedRandom } from "@utils/seededRandom";

const CORPORA: Array<{ name: string; statements: string[] }> = [
  {
    name: "kitchen",
    statements: [
      "kitchen contains counter",
      "kitchen contains fridge",
      "counter holds bowl",
      "bowl contains apple",
      "bowl contains orange",
      "cup on counter",
      "plate near cup",
      "knife beside plate",
    ],
  },
  {
    name: "desk",
    statements: [
      "desk holds laptop",
      "desk holds lamp",
      "laptop near mug",
      "mug on coaster",
      "coaster on desk",
      "pen beside laptop",
      "notebook under laptop",
    ],
  },
  {
    name: "nested rooms",
    statements: [
      "house contains kitchen",
      "house contains bedroom",
      "kitchen contains oven",
      "kitchen contains sink",
      "bedroom contains bed",
      "bedroom contains wardrobe",
      "wardrobe contains shirt",
    ],
  },
  {
    name: "object stack",
    statements: [
      "table holds tray",
      "plate on tray",
      "sandwich on plate",
      "napkin on sandwich",
      "cup near plate",
      "straw in cup",
    ],
  },
  {
    name: "coreference",
    statements: [
      "ball on floor",
      "red ball same as ball",
      "toy same as red ball",
      "floor near wall",
      "mat on floor",
      "cat on mat",
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

interface Row {
  name: string;
  nodes: number;
  edges: number;
  kinds: string;
  pairs: number;
  pStruct: number;
  sStruct: number;
  pNull: number;
  onStruct: number;
  monoStruct: number;
  reachStruct: number;
  onNull: number;
  pass: boolean;
}

async function scoreCorpus(
  name: string,
  statements: string[]
): Promise<Row | null> {
  const graph = buildGraphFromScene(statements);
  if (graph.nodes.length < 4 || graph.edges.length < 3) return null;
  const kinds = new Set(graph.edges.map(e => e.kind));

  seedRandom(0);
  const sys = new System();
  const atom = new SceneAtomizer();
  await atom.init();
  const { nodeToPrecept, placement } = groundGraphIntoSystem(graph, sys, atom, {
    seed: 0,
  });
  if (!placement) return null;

  const fStatic = mapFidelity(graph, placement, { seed: 1 });
  const fNullStatic = mapFidelity(graph, shufflePlacement(graph.nodes.length), {
    seed: 1,
  });

  const traveler = new Traveler(sys);
  const fStruct = await traversalFidelity(
    graph,
    nodeToPrecept,
    (s, t) => traveler.traverse(s, t),
    { maxPairs: 48 }
  );
  if (fStruct.pairs < 3) return null;

  seedRandom(0);
  const nullSys = new System();
  const nullAtom = new SceneAtomizer();
  await nullAtom.init();
  const { nodeToPrecept: n2p } = groundGraphIntoSystem(
    graph,
    nullSys,
    nullAtom,
    {
      seed: 0,
    }
  );
  for (let i = 0; i < graph.nodes.length; i++) {
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
    graph,
    n2p,
    (s, t) => nullTraveler.traverse(s, t),
    { maxPairs: 48 }
  );

  const pass =
    fStatic.pearson > fNullStatic.pearson + 0.2 &&
    fStatic.separation > fNullStatic.separation * 1.3 &&
    fStruct.onPathRate > 0.4 &&
    fStruct.onPathRate > fNull.onPathRate * 2;

  return {
    name,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    kinds: [...kinds].sort().join(""),
    pairs: fStruct.pairs,
    pStruct: fStatic.pearson,
    sStruct: fStatic.separation,
    pNull: fNullStatic.pearson,
    onStruct: fStruct.onPathRate,
    monoStruct: fStruct.monotonicity,
    reachStruct: fStruct.reachRate,
    onNull: fNull.onPathRate,
    pass,
  };
}

async function main(): Promise<void> {
  (DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;
  console.log("\nScene-graph cross-corpus fidelity sweep\n");
  console.log(
    "  (structure-grounded vs shuffled null; same machinery proven on code/logic)\n"
  );

  const rows: Row[] = [];
  for (const c of CORPORA) {
    const r = await scoreCorpus(c.name, c.statements);
    if (r) rows.push(r);
  }

  let passes = 0;
  let sumOn = 0;
  let sumP = 0;
  for (const r of rows) {
    if (r.pass) passes++;
    sumOn += r.onStruct;
    sumP += r.pStruct;
    console.log(
      `  ${r.name.padEnd(14)} n=${String(r.nodes).padStart(2)} e=${String(r.edges).padStart(2)} ` +
        `edgeKinds=${r.kinds.padEnd(3)} pairs=${String(r.pairs).padStart(2)}  ` +
        `static[pearson=${r.pStruct.toFixed(2)} sep=${r.sStruct.toFixed(2)} vs null ${r.pNull.toFixed(2)}]  ` +
        `dyn[onPath=${r.onStruct.toFixed(2)} mono=${r.monoStruct.toFixed(2)} reach=${r.reachStruct.toFixed(2)} vs null ${r.onNull.toFixed(2)}]  ` +
        `${r.pass ? "PASS" : "----"}`
    );
  }

  console.log(
    `\n  ${passes}/${rows.length} corpora PASS  ` +
      `(mean static pearson=${(sumP / Math.max(1, rows.length)).toFixed(2)}, ` +
      `mean dynamic onPath=${(sumOn / Math.max(1, rows.length)).toFixed(2)})\n`
  );
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
