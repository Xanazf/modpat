/**
 * Phase 5 - coordinate-source migration diagnostic.
 *
 * Question: when language references a symbol that already lives in the manifold
 * as a structurally-grounded precept, does referent-seeding place the language
 * atom ON the faithful map (inheriting the grounded posX), where GloVe would have
 * scattered it by co-occurrence?
 *
 * Method: ground a TS corpus into a System (StructuralGrounding/SMACOF, no
 * embeddings), then re-ingest each single-word node label AS LANGUAGE through the
 * atomizer and read where the language atom lands on posX. Compare two modes:
 *   OFF - REFERENT_GROUNDING_ENABLED=false: posX = GloVe co-occurrence (legacy).
 *   ON  - REFERENT_GROUNDING_ENABLED=true:  posX = referent's grounded posX.
 *
 * Metrics (per mode):
 *   - hit-rate: fraction of matchable labels whose language atom found a referent.
 *   - mean |langPosX - groundedPosX|: how far the language atom sits from the
 *     grounded truth (ON should be ~0; OFF is the GloVe gap).
 *   - X-faithfulness: mapFidelity over a placement whose x = the LANGUAGE atom's
 *     posX (y=z=w=0), so it scores how well the language layer's X mirrors the
 *     graph. ON should match the grounded-X baseline; OFF should collapse toward
 *     a co-occurrence null.
 */

import SemanticAtomizer from "@atomics/SemanticAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import {
  buildGridIndex,
  getMetricForce,
  makeLocomotionState,
} from "@skill_cogi/Locomotion";
import { settleAtoms } from "@skill_cogi/Perception";
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

interface ModeResult {
  hitRate: number;
  matchable: number;
  hits: number;
  meanDistToGround: number;
  pearson: number;
  separation: number;
}

async function runMode(enabled: boolean): Promise<ModeResult> {
  DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = enabled;
  seedRandom(0);

  const system = new System();
  const atomizer = new SemanticAtomizer();
  await atomizer.init();

  const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
    includeCallSites: true,
  });
  const { graph, nodeToPrecept } = groundAstIntoSystem(
    triples,
    system,
    atomizer,
    {
      seed: 0,
    }
  );
  const n = graph.nodes.length;

  // Grounded posX truth per node (the faithful X-layout we want language to inherit).
  const groundedX = new Float64Array(n);
  for (let i = 0; i < n; i++) groundedX[i] = system.posX[nodeToPrecept[i]];

  // Re-ingest each label as language; record the resulting language atom posX.
  const langX = new Float64Array(n);
  let matchable = 0;
  let hits = 0;
  let distSum = 0;
  for (let i = 0; i < n; i++) {
    const label = graph.nodes[i].label.toLowerCase();
    // Only single-word labels round-trip to the grounded scope through the
    // tokenizer (dotted/multi-word identifiers re-tokenize to different scopes,
    // which is not the referencing case this measures).
    const ids = atomizer.ingestSequence(label, system);
    if (ids.length !== 1) {
      langX[i] = groundedX[i]; // not part of the comparison; keep placement sane
      continue;
    }
    matchable++;
    const lx = system.posX[ids[0]];
    langX[i] = lx;
    const d = Math.abs(lx - groundedX[i]);
    distSum += d;
    if (d < 1e-6) hits++;
  }

  const placement: Grounding.Placement = {
    x: langX,
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: new Float64Array(n),
  };
  const f = mapFidelity(graph, placement, { seed: 1 });

  return {
    hitRate: matchable > 0 ? hits / matchable : 0,
    matchable,
    hits,
    meanDistToGround: matchable > 0 ? distSum / matchable : 0,
    pearson: f.pearson,
    separation: f.separation,
  };
}

/**
 * Faithfully reproduces what POLE_INGESTION_ENABLED=true would do to
 * referent-seeded atoms: record the (grounded) position as the drift target,
 * jitter the atom to the manifold pole, then settle it back under the metric
 * force toward the target (the real Perception.settleAtoms). Measures how much
 * of the validated direct placement survives the pole round-trip.
 */
async function runPoleMode(): Promise<ModeResult> {
  DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = true;
  seedRandom(0);

  const system = new System();
  const atomizer = new SemanticAtomizer();
  await atomizer.init();
  const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
    includeCallSites: true,
  });
  const { graph, nodeToPrecept } = groundAstIntoSystem(
    triples,
    system,
    atomizer,
    {
      seed: 0,
    }
  );
  const n = graph.nodes.length;
  const groundedX = new Float64Array(n);
  for (let i = 0; i < n; i++) groundedX[i] = system.posX[nodeToPrecept[i]];

  const { POLE_JITTER_XYZ, POLE_JITTER_W } = DOPAT_CONFIG.PHYSICS;
  const langAtom = new Int32Array(n).fill(-1);
  const driftTargets = new Map<
    number,
    readonly [number, number, number, number]
  >();
  let matchable = 0;
  for (let i = 0; i < n; i++) {
    const label = graph.nodes[i].label.toLowerCase();
    const ids = atomizer.ingestSequence(label, system);
    if (ids.length !== 1) continue;
    matchable++;
    const id = ids[0];
    langAtom[i] = id;
    // _poleSettle: target = the (referent-seeded) position, then jitter to pole.
    driftTargets.set(id, [
      system.posX[id],
      system.posY[id],
      system.posZ[id],
      system.posW[id],
    ]);
    system.posX[id] = (random() - 0.5) * 2 * POLE_JITTER_XYZ;
    system.posY[id] = (random() - 0.5) * 2 * POLE_JITTER_XYZ;
    system.posZ[id] = (random() - 0.5) * 2 * POLE_JITTER_XYZ;
    system.posW[id] = Math.abs((random() - 0.5) * 2 * POLE_JITTER_W);
    system.update(id);
  }

  const loco = makeLocomotionState();
  buildGridIndex(system, loco);
  const allIds = Uint32Array.from(
    [...driftTargets.keys()].filter(id => id >= 0)
  );
  // The real settling step (spring toward drift target under -∇V).
  settleAtoms(allIds, driftTargets, undefined, undefined, {
    system,
    getMetricForce: (
      px: number,
      py: number,
      pz: number,
      pw: number,
      pens: unknown[],
      boost: Set<number> | undefined,
      active: Set<number> | undefined
    ) =>
      getMetricForce(
        px,
        py,
        pz,
        pw,
        pens as never[],
        boost,
        active,
        system,
        loco
      ),
  } as any);

  const langX = new Float64Array(n);
  let hits = 0;
  let distSum = 0;
  for (let i = 0; i < n; i++) {
    if (langAtom[i] < 0) {
      langX[i] = groundedX[i];
      continue;
    }
    const lx = system.posX[langAtom[i]];
    langX[i] = lx;
    const d = Math.abs(lx - groundedX[i]);
    distSum += d;
    if (d < 1e-6) hits++;
  }
  const placement: Grounding.Placement = {
    x: langX,
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: new Float64Array(n),
  };
  const f = mapFidelity(graph, placement, { seed: 1 });
  return {
    hitRate: matchable > 0 ? hits / matchable : 0,
    matchable,
    hits,
    meanDistToGround: matchable > 0 ? distSum / matchable : 0,
    pearson: f.pearson,
    separation: f.separation,
  };
}

async function baselineGroundedX(): Promise<{
  pearson: number;
  separation: number;
}> {
  seedRandom(0);
  const system = new System();
  const atomizer = new SemanticAtomizer();
  await atomizer.init();
  const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
    includeCallSites: true,
  });
  const { graph, nodeToPrecept } = groundAstIntoSystem(
    triples,
    system,
    atomizer,
    {
      seed: 0,
    }
  );
  const n = graph.nodes.length;
  const placement: Grounding.Placement = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) placement.x[i] = system.posX[nodeToPrecept[i]];
  const f = mapFidelity(graph, placement, { seed: 1 });
  return { pearson: f.pearson, separation: f.separation };
}

async function main() {
  const original = DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED;
  try {
    const base = await baselineGroundedX();
    const off = await runMode(false);
    const on = await runMode(true);
    const pole = await runPoleMode();

    const row = (label: string, r: ModeResult) =>
      `  ${label.padEnd(18)} hit-rate=${(r.hitRate * 100).toFixed(0).padStart(3)}% ` +
      `(${r.hits}/${r.matchable})  meanDistToGround=${r.meanDistToGround.toFixed(3)}  ` +
      `pearson=${r.pearson.toFixed(3)}  separation=${r.separation.toFixed(2)}`;

    console.log("\n=== Phase 5: coordinate-source migration ===\n");
    console.log(
      `  grounded-X baseline   pearson=${base.pearson.toFixed(3)}  ` +
        `separation=${base.separation.toFixed(2)}  (the faithful X-layout target)\n`
    );
    console.log(
      "  Language-layer X-faithfulness (placement x = language atom posX):"
    );
    console.log(row("OFF (GloVe)", off));
    console.log(row("ON (referent)", on));
    console.log(row("ON + pole+settle", pole));
    console.log(
      `\n  Verdict: referent-seeding ${
        on.pearson >= off.pearson && on.meanDistToGround <= off.meanDistToGround
          ? "PLACES LANGUAGE ON THE FAITHFUL MAP"
          : "did NOT improve over GloVe"
      } ` +
        `(Δpearson=${(on.pearson - off.pearson).toFixed(3)}, ` +
        `ON-dist ${on.meanDistToGround.toFixed(3)} vs OFF-dist ${off.meanDistToGround.toFixed(3)}).\n`
    );
  } finally {
    DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = original;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
