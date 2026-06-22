/**
 * Pipeline end-to-end latency benchmark.
 * Run: tsx tests/benchmarks/pipeline_bench.ts
 *
 * Measures p50/p95 query latency for three query types across corpus sizes.
 * Commit baseline output to plans/benchmark_baseline.txt for comparison with Track 3 results.
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";

const CORPUS_SIZES = [100, 1_000, 5_000];
const QUERIES = [
  "sky implies", // Phase 0/1 semantic lookup
  "alpha implies beta |-", // Phase 2 direct deduction
  "rain implies wet && wet implies growth |-", // Phase 2 transitivity
];
const SAMPLES_PER_QUERY = 10;

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(p * sorted.length), sorted.length - 1);
  return sorted[idx];
}

// Distinct atoms to cycle through; small vocabulary avoids operator-band overflow.
const ATOMS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "omicron",
  "pi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
];

async function buildFixture(n: number): Promise<{
  system: System;
  atomizer: LogicAtomizer;
  store: Store;
  resolver: Traveler;
}> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer);
  await store.waitForInit();
  const resolver = new Traveler(system, atomizer, store);

  // Populate with n simple implication facts using a small cyclic vocabulary.
  // Using only "implies" operator (registered very early) avoids operator-band overflow.
  for (let i = 0; i < n; i++) {
    const a = ATOMS[i % ATOMS.length];
    const b = ATOMS[(i + 1) % ATOMS.length];
    atomizer.ingestSequence(`${a} implies ${b}`, system);
  }
  // Ingest the base facts required by the benchmark queries.
  atomizer.ingestSequence("sky implies blue", system);
  atomizer.ingestSequence("rain implies wet", system);
  atomizer.ingestSequence("wet implies growth", system);

  return { system, atomizer, store, resolver };
}

async function run(): Promise<void> {
  console.log("Pipeline benchmark, resolver CPU path (base atomizer)\n");
  console.log(
    `${"n".padStart(6)}  ${"query".padStart(38)}  ${"p50".padStart(8)}  ${"p95".padStart(8)}`
  );
  console.log("".repeat(70));

  for (const n of CORPUS_SIZES) {
    const { system, atomizer, store, resolver } = await buildFixture(n);

    for (const q of QUERIES) {
      const qIds = atomizer.ingestSequence(q, system);

      // Warm-up
      await resolver.resolveSequence(qIds);

      const samples: number[] = [];
      for (let i = 0; i < SAMPLES_PER_QUERY; i++) {
        const t0 = performance.now();
        await resolver.resolveSequence(qIds);
        samples.push(performance.now() - t0);
      }
      const p50 = percentile(samples, 0.5);
      const p95 = percentile(samples, 0.95);
      const qShort = q.length > 36 ? `${q.slice(0, 33)}…` : q;
      console.log(
        `${n.toString().padStart(6)}  ${qShort.padStart(38)}  ${p50.toFixed(1).padStart(7)}ms  ${p95.toFixed(1).padStart(7)}ms`
      );
    }

    await store.close();
    await resolver.dispose();
  }
}

run()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
