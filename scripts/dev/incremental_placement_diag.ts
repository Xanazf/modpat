/**
 * Incremental, operator-anchored placement - the P1/P4 O(N²) boundary, measured.
 *
 * 1. PARITY - on the standard grounded TS corpus (small), incremental placement
 *    must score close to the exact global SMACOF on mapFidelity, and both must
 *    crush the shuffled null.
 * 2. SCALE - on a synthetic ~12k-node code-shaped graph (hub-heavy call tree +
 *    cross refs), global SMACOF is past the cap; incremental places it in
 *    seconds and the fidelity must still hold up vs its null.
 *
 * Run: tsx scripts/dev/incremental_placement_diag.ts
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import {
  buildGraphFromAstTriples,
  EdgeKind,
  NodeKind,
} from "@core_s/grounding/GroundGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import {
  placeGraph,
  placeGraphIncremental,
  randomPlacement,
} from "@core_s/grounding/StructuralGrounding";
import { extractAstTriples } from "@utils/astExtract";
import { random, seedRandom } from "@utils/seededRandom";

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

/**
 * Code-shaped synthetic graph with REALISTIC locality: modules form a
 * dependency chain; each symbol lives in one module (containment), references
 * mostly stay within the module, and cross-module references only follow the
 * module chain. Real repos are hierarchical and local like this - the earlier
 * expander-style generator (random module assignment + uniform far refs) was
 * unembeddable in 3-D even for global SMACOF (pearson 0.376 at n=1000), so it
 * measured the GRAPH, not the placer.
 */
function syntheticRepoGraph(nNodes: number): Grounding.GroundGraph {
  seedRandom(7);
  const nodes = [];
  const edges = [];
  const perModule = 40;
  const modules = Math.max(1, Math.floor(nNodes / perModule));
  for (let i = 0; i < nNodes; i++) {
    nodes.push({
      id: i,
      label: `sym_${i}`,
      kind: i < modules ? NodeKind.Module : NodeKind.Function,
      numeric: null,
    });
  }
  // Module dependency chain (the macro-structure a layout can stretch along).
  for (let m = 1; m < modules; m++) {
    edges.push({ from: m, to: m - 1, kind: EdgeKind.Reference, weight: 1 });
  }
  for (let i = modules; i < nNodes; i++) {
    const mod = (i - modules) % modules; // symbols spread evenly over modules
    edges.push({ from: mod, to: i, kind: EdgeKind.Containment, weight: 1 });
    const refs = 1 + Math.floor(random() * 2);
    for (let r = 0; r < refs; r++) {
      const cross = random() < 0.1;
      let j: number;
      if (cross) {
        // Cross-module ref: a symbol in an adjacent module on the chain.
        const nm = Math.max(
          0,
          Math.min(modules - 1, mod + (random() < 0.5 ? -1 : 1))
        );
        j =
          modules +
          nm +
          modules * Math.floor(random() * ((nNodes - modules) / modules - 1));
      } else {
        // Local ref: a symbol of the same module.
        j =
          modules +
          mod +
          modules * Math.floor(random() * ((nNodes - modules) / modules - 1));
      }
      if (j !== i && j < nNodes)
        edges.push({ from: i, to: j, kind: EdgeKind.Reference, weight: 1 });
    }
  }
  return { nodes, edges };
}

async function main(): Promise<void> {
  // -- 1. parity on the real grounded corpus --------------------------------
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
    includeCallSites: true,
  });
  const g = buildGraphFromAstTriples(triples);

  const global = mapFidelity(g, placeGraph(g, { seed: 0 }));
  const incr = mapFidelity(
    g,
    placeGraphIncremental(g, { seed: 0, anchorCount: 8 })
  );
  const nul = mapFidelity(g, randomPlacement(g));
  console.log("=== parity (real corpus, anchors << nodes) ===");
  console.log(
    `  global SMACOF: pearson=${global.pearson.toFixed(3)} separation=${global.separation.toFixed(2)}`
  );
  console.log(
    `  incremental  : pearson=${incr.pearson.toFixed(3)} separation=${incr.separation.toFixed(2)}`
  );
  console.log(
    `  shuffled null: pearson=${nul.pearson.toFixed(3)} separation=${nul.separation.toFixed(2)}`
  );

  // -- 2. scale ---------------------------------------------------------------
  console.log(
    "\n=== scale (synthetic code-shaped graph, past the global cap) ==="
  );
  for (const n of [4000, 12000]) {
    const big = syntheticRepoGraph(n);
    const t0 = performance.now();
    const p = placeGraphIncremental(big, { seed: 0 });
    const ms = performance.now() - t0;
    const f = mapFidelity(big, p);
    const fn = mapFidelity(big, randomPlacement(big));
    console.log(
      `  n=${n} edges=${big.edges.length}: placed in ${(ms / 1000).toFixed(1)}s  ` +
        `pearson=${f.pearson.toFixed(3)} separation=${f.separation.toFixed(2)}  ` +
        `(null: ${fn.pearson.toFixed(3)} / ${fn.separation.toFixed(2)})`
    );
  }

  // Reference: how long would the global solve take at 4k? (one timing point,
  // small iteration count, extrapolated - just to size the boundary.)
  const big = syntheticRepoGraph(4000);
  const t0 = performance.now();
  placeGraph(big, { seed: 0, iterations: 10 });
  const per10 = performance.now() - t0;
  console.log(
    `  global SMACOF at n=4000 (10 of 200 iters): ${(per10 / 1000).toFixed(1)}s ` +
      `=> full solve ≈ ${((per10 * 20) / 1000).toFixed(0)}s`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
