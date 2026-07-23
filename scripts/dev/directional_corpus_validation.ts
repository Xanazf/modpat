/**
 * Labeled-corpus validation for the reasoning-vs-rationalization signal.
 *
 * Drives the REAL ingest pipeline (semantic atomizer + manifold clock), so
 * wBirth (born-position), posW (firing recency) and scopes are all pipeline-
 * produced - not hand-set. The only thing this script scripts is FIRING ORDER,
 * which is exactly the ground-truth label:
 *
 *   - reasoning      : the premises (established evidence) fire last → the wave
 *                      originates there and rides FORWARD to the conclusion.
 *   - rationalization: the conclusion (an intent) fires last → it reaches BACK
 *                      to older established premises to justify itself.
 *
 * Firing is applied with the production primitive (refreshConceptAgeForIds), the
 * same call a vault hit makes. Every scenario establishes its premise BEFORE its
 * conclusion (premises older-born), so the geometry is identical across labels;
 * only the firing order differs. The classifier must recover the label from that.
 *
 * Reports three things:
 *   1. Balanced accuracy WITH referent remap (the shipped path).
 *   2. Balanced accuracy WITHOUT remap (classifying the throwaway probe atoms) -
 *      the control that shows the remap is load-bearing.
 *   3. The falsifiable amplitude claim: mean forward vs mean backward amplitude
 *      over the identical support sets (THEORY.md: backward is systematically
 *      lower amplitude).
 *
 * Run: tsx scripts/dev/directional_corpus_validation.ts
 */

import Runtime from "@core_i/Runtime";
import {
  classifyInferenceDirection,
  measureInferenceAmplitude,
  resolveReferents,
} from "@skill_cogi/DirectionalPropagation";

type Label = "reasoning" | "rationalization";

/** One establishment event: ingest a premise (by index) or the conclusion,
 *  after advancing the manifold clock by `gapMsBefore`. The schedule is what
 *  varies born-distance, support size, and ordering across scenarios. */
type Ingest = "c" | number;
interface Step {
  ingest: Ingest;
  gapMsBefore: number;
}

interface Scenario {
  premises: string[];
  conclusion: string;
  label: Label;
  /** Establishment schedule - must ingest the conclusion and every premise. */
  steps: Step[];
  /** Clock advance before the query/firing phase. */
  queryGapMs: number;
}

// Content is irrelevant to the label - the label IS the firing order, applied
// below. Distinct vocabulary across the whole corpus keeps scope sets disjoint.
// Spreads are varied deliberately: tiny vs huge born-distance, 1-3 premises with
// staggered ages, and one reasoning case with premises NEWER-born than the
// conclusion (δ < 0 - established conclusion, later evidence fires forward).
const CORPUS: Scenario[] = [
  // reasoning, tiny born-distance (~1s)
  {
    premises: ["rain"],
    conclusion: "flood",
    label: "reasoning",
    steps: [{ ingest: 0, gapMsBefore: 0 }, { ingest: "c", gapMsBefore: 1000 }],
    queryGapMs: 2000,
  },
  // reasoning, large born-distance (~20s)
  {
    premises: ["fire"],
    conclusion: "smoke",
    label: "reasoning",
    steps: [{ ingest: 0, gapMsBefore: 0 }, { ingest: "c", gapMsBefore: 20000 }],
    queryGapMs: 3000,
  },
  // reasoning, 2 premises with staggered ages
  {
    premises: ["study", "effort"],
    conclusion: "knowledge",
    label: "reasoning",
    steps: [
      { ingest: 0, gapMsBefore: 0 },
      { ingest: 1, gapMsBefore: 6000 },
      { ingest: "c", gapMsBefore: 6000 },
    ],
    queryGapMs: 2000,
  },
  // reasoning, premises NEWER-born than conclusion (δ < 0): conclusion is
  // established first, evidence arrives later and fires forward to support it.
  {
    premises: ["water"],
    conclusion: "erosion",
    label: "reasoning",
    steps: [{ ingest: "c", gapMsBefore: 0 }, { ingest: 0, gapMsBefore: 15000 }],
    queryGapMs: 2000,
  },
  // reasoning, medium born-distance
  {
    premises: ["exercise"],
    conclusion: "strength",
    label: "reasoning",
    steps: [{ ingest: 0, gapMsBefore: 0 }, { ingest: "c", gapMsBefore: 8000 }],
    queryGapMs: 2000,
  },
  // rationalization, tiny born-distance
  {
    premises: ["winter"],
    conclusion: "snow",
    label: "rationalization",
    steps: [{ ingest: 0, gapMsBefore: 0 }, { ingest: "c", gapMsBefore: 1500 }],
    queryGapMs: 2000,
  },
  // rationalization, huge born-distance (~25s)
  {
    premises: ["spark"],
    conclusion: "flame",
    label: "rationalization",
    steps: [{ ingest: 0, gapMsBefore: 0 }, { ingest: "c", gapMsBefore: 25000 }],
    queryGapMs: 3000,
  },
  // rationalization, 2 premises (one ancient, one recent)
  {
    premises: ["practice", "talent"],
    conclusion: "skill",
    label: "rationalization",
    steps: [
      { ingest: 0, gapMsBefore: 0 },
      { ingest: 1, gapMsBefore: 18000 },
      { ingest: "c", gapMsBefore: 4000 },
    ],
    queryGapMs: 2000,
  },
  // rationalization, medium born-distance
  {
    premises: ["fever"],
    conclusion: "sickness",
    label: "rationalization",
    steps: [{ ingest: 0, gapMsBefore: 0 }, { ingest: "c", gapMsBefore: 7000 }],
    queryGapMs: 2000,
  },
  // rationalization, 3 premises with mixed ages
  {
    premises: ["cloud", "wind", "moisture"],
    conclusion: "storm",
    label: "rationalization",
    steps: [
      { ingest: 0, gapMsBefore: 0 },
      { ingest: 1, gapMsBefore: 10000 },
      { ingest: 2, gapMsBefore: 5000 },
      { ingest: "c", gapMsBefore: 5000 },
    ],
    queryGapMs: 2000,
  },
];

export interface Row {
  label: Label;
  nPrem: number;
  predRemap: Label;
  predRaw: Label;
  ratio: number;
  fwd: number;
  bwd: number;
}

export interface CorpusResult {
  rows: Row[];
  accRemap: number;
  accRaw: number;
  meanFwd: number;
  meanBwd: number;
}

/**
 * Boots a real semantic runtime, runs the labeled corpus, and returns the rows
 * plus aggregate metrics. Shared by the CLI (main) and the guard test.
 */
export async function evaluateCorpus(): Promise<CorpusResult> {
  const rt = await Runtime.boot({
    atomizer: "semantic",
    db: ":memory:",
    noTick: true,
    noLifecycle: true,
    skipIdentity: true,
    noWorkers: true,
  });
  await rt.ready;
  const sys = rt.system;
  const atomizer = rt.atomizer;

  const rows: Row[] = [];

  for (const sc of CORPUS) {
    // 1. Establishment: follow the scenario's schedule via the real atomizer.
    //    Born-distances fall out of the clock advances between events.
    let conclusionId = -1;
    const establishedPremise: number[] = new Array(sc.premises.length).fill(-1);
    for (const step of sc.steps) {
      if (step.gapMsBefore > 0) sys.decay(step.gapMsBefore);
      if (step.ingest === "c") {
        conclusionId = atomizer.ingestSequence(sc.conclusion, sys)[0];
      } else {
        establishedPremise[step.ingest] = atomizer.ingestSequence(
          sc.premises[step.ingest],
          sys
        )[0];
      }
    }

    // 2. The "query": mint fresh throwaway probe atoms for each premise (wBirth =
    //    now), exactly as challenge() does. resolveReferents must map these back
    //    to the established referents.
    if (sc.queryGapMs > 0) sys.decay(sc.queryGapMs);
    const probe: number[] = [];
    for (const word of sc.premises) {
      probe.push(atomizer.ingestSequence(word, sys)[0]);
    }
    const probeIds = Uint32Array.from(probe);
    const referents = resolveReferents(sys, probeIds);

    // 3. Fire per label, with the production primitive.
    if (sc.label === "reasoning") {
      sys.refreshConceptAgeForIds(referents); // premises fire last
    } else {
      sys.refreshConceptAgeForIds([conclusionId]); // conclusion fires last
    }

    // 4. Classify - shipped path (referents) and control (raw probe atoms).
    const dRemap = classifyInferenceDirection(sys, conclusionId, referents);
    const dRaw = classifyInferenceDirection(sys, conclusionId, probeIds);

    // 5. Falsifiable amplitude claim over the identical (referent) support set.
    const fwd = measureInferenceAmplitude(
      sys,
      conclusionId,
      referents,
      "reasoning"
    ).amplitude;
    const bwd = measureInferenceAmplitude(
      sys,
      conclusionId,
      referents,
      "rationalization"
    ).amplitude;

    rows.push({
      label: sc.label,
      nPrem: sc.premises.length,
      predRemap: dRemap.isRationalization ? "rationalization" : "reasoning",
      predRaw: dRaw.isRationalization ? "rationalization" : "reasoning",
      ratio: dRemap.ratio,
      fwd,
      bwd,
    });
  }

  await rt.dispose?.();

  const accRemap = balancedAccuracy(rows, r => r.predRemap);
  const accRaw = balancedAccuracy(rows, r => r.predRaw);
  const meanFwd = rows.reduce((a, r) => a + r.fwd, 0) / rows.length;
  const meanBwd = rows.reduce((a, r) => a + r.bwd, 0) / rows.length;
  return { rows, accRemap, accRaw, meanFwd, meanBwd };
}

async function main(): Promise<void> {
  const result = await evaluateCorpus();
  report(result);
}

function balancedAccuracy(rows: Row[], pick: (r: Row) => Label): number {
  const classes: Label[] = ["reasoning", "rationalization"];
  let sum = 0;
  for (const cls of classes) {
    const inClass = rows.filter(r => r.label === cls);
    const correct = inClass.filter(r => pick(r) === cls).length;
    sum += inClass.length > 0 ? correct / inClass.length : 0;
  }
  return sum / classes.length;
}

function report(result: CorpusResult): void {
  const { rows, accRemap, accRaw, meanFwd, meanBwd } = result;
  console.log("\n=== Per-scenario ===");
  console.log("label            | n | pred(remap)      | pred(raw)        | ratio  | fwd     | bwd");
  for (const r of rows) {
    const ok = r.predRemap === r.label ? " " : "✗";
    console.log(
      `${ok} ${r.label.padEnd(15)} | ${r.nPrem} | ${r.predRemap.padEnd(16)} | ${r.predRaw.padEnd(16)} | ${r.ratio.toFixed(3)} | ${r.fwd.toFixed(3)} | ${r.bwd.toFixed(3)}`
    );
  }

  const ratlRatios = rows
    .filter(r => r.label === "rationalization")
    .map(r => r.ratio);
  const ratioSpread = Math.max(...ratlRatios) - Math.min(...ratlRatios);

  console.log("\n=== Summary ===");
  console.log(`balanced accuracy  WITH referent remap : ${(accRemap * 100).toFixed(1)}%`);
  console.log(`balanced accuracy  WITHOUT remap (ctrl) : ${(accRaw * 100).toFixed(1)}%`);
  console.log(
    `falsifiable claim  mean fwd ${meanFwd.toFixed(3)} > mean bwd ${meanBwd.toFixed(3)} : ${meanFwd > meanBwd ? "HOLDS" : "FAILS"}`
  );
  console.log(
    `geometry varied    rationalization ratio spread : ${ratioSpread.toFixed(3)} (range ${Math.min(...ratlRatios).toFixed(3)}..${Math.max(...ratlRatios).toFixed(3)})`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
