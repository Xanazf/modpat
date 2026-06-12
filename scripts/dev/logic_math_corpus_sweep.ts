/**
 * Logic/math cross-corpus fidelity sweep (closes the P4/P5 open item).
 * Run: tsx scripts/dev/logic_math_corpus_sweep.ts
 *
 * P1/P4 proved grounding + traversal are FAITHFUL on CODE corpora (static
 * mapFidelity pearson 0.94, dynamic traversal onPath 0.71/0.95 vs a shuffled
 * null ~0.09). The roadmap's unified-domain thesis says logic and math are the
 * SAME typed graph, so the SAME machinery should be faithful on them too - but
 * that was never measured because no logic/math parser fed `GroundGraph`.
 * `LogicGraph.buildGraphFromLogic` now does. This sweep runs the identical
 * structural-vs-shuffled-null comparison over a battery of logic/math corpora:
 *
 *   static  : mapFidelity(graph, structural placement)  vs  shuffled placement
 *   dynamic : traversalFidelity(traverse)               vs  shuffled-coordinate null
 *
 * A corpus PASSES when the structural map is faithful (pearson up, separation up)
 * AND the traversal tracks the graph geodesic far better than the shuffled null.
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundGraphIntoSystem } from "@core_s/grounding/AstGrounding";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { random, seedRandom } from "@utils/seededRandom";

const CORPORA: Array<{ name: string; statements: string[] }> = [
  {
    name: "syllogism tree",
    statements: [
      "all dogs are mammals",
      "all cats are mammals",
      "all mammals are animals",
      "all birds are animals",
      "all animals are organisms",
      "all organisms are entities",
      "rex is a dog",
      "felix is a cat",
      "tweety is a bird",
    ],
  },
  {
    name: "implication chain",
    statements: [
      "p implies q",
      "q implies r",
      "r implies s",
      "s implies t",
      "t implies u",
      "u implies v",
      "v implies w",
    ],
  },
  {
    name: "arithmetic",
    statements: [
      "3 + 4 = 7",
      "1 + 2 = 3",
      "5 + 2 = 7",
      "2 + 5 = 7",
      "6 - 2 = 4",
      "4 + 3 = 7",
      "1 + 3 = 4",
    ],
  },
  {
    name: "mixed KB",
    statements: [
      "all squares are rectangles",
      "all rectangles are quadrilaterals",
      "all quadrilaterals are polygons",
      "all polygons are shapes",
      "all triangles are polygons",
      "all circles are shapes",
      "figure1 is a square",
      "figure2 is a triangle",
      "p implies q",
      "q implies polygon",
    ],
  },
  {
    name: "modus ponens KB",
    statements: [
      "p implies q && q implies r |- p implies r",
      "a implies b",
      "b implies c",
      "c implies d",
      "d implies e",
      "all m are n",
      "s is a m",
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
  const graph = buildGraphFromLogic(statements);
  if (graph.nodes.length < 4 || graph.edges.length < 3) return null;

  // Faithful, structure-grounded System.
  seedRandom(0);
  const sys = new System();
  const atom = new LogicAtomizer();
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

  // Shuffled-coordinate null: same precepts + graph, random positions.
  seedRandom(0);
  const nullSys = new System();
  const nullAtom = new LogicAtomizer();
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
  console.log("\nLogic/math cross-corpus fidelity sweep\n");
  console.log(
    "  (structure-grounded vs shuffled null; same machinery proven on code)\n"
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
      `  ${r.name.padEnd(18)} n=${String(r.nodes).padStart(2)} e=${String(r.edges).padStart(2)} ` +
        `pairs=${String(r.pairs).padStart(2)}  ` +
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
