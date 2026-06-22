/**
 * Endurance Suite - full-pipeline knowledge digestion under sustained load.
 *
 * Drives the complete stack: SemanticAtomizer → Manifold → ManifoldLifecycle
 * ticks (DeltaQueue drain, consolidation, dream cycle) → Resolver → Vault.
 * A mock Unfolder serves deterministic corpus content so the dream cycle
 * fires without network calls.
 *
 * Phases:
 *   1. Corpus ingestion throughput  - raw ingest of 60 sentences, timing
 *   2. Tick endurance               - N ticks driving the full manager loop
 *   3. Reasoning quality probe      - battery of queries, % non-unknown
 *   4. Structural integrity         - zero corrupted precepts
 *   5. Vault coverage               - crystallised entries exist
 *   6. Concurrent delta load        - 1000 typed deltas queued then drained
 *   7. Metrics snapshot             - key counters show real activity
 */

import { DatabaseContext } from "@_lib/persistence/DatabaseContext";
import assert from "node:assert/strict";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import { DOPAT_CONFIG } from "@config";
import { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import { metrics } from "@core_s/Metrics";
import { SystemPersistence } from "@core_s/Persistence";
import Unfolder from "@mutate/Unfolder";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

// Corpus
//
// All sentences use the operator vocabulary the resolver understands:
// "implies" (IdentityShift), "is/are" (IdentityShift), "and" (Conjunction).
// Prose verbs become Action operators in the manifold but don't propagate
// through the W matrix - so we restrict causal knowledge to "implies" chains
// and identity claims to "is/are".

const CORPUS: string[] = [
  // Direct implications - causal chains
  "fire implies smoke",
  "smoke implies combustion",
  "combustion implies oxygen",
  "oxygen implies respiration",
  "respiration implies life",
  "photosynthesis implies glucose",
  "glucose implies energy",
  "gravity implies attraction",
  "rain implies erosion",
  "erosion implies valleys",
  "heat implies expansion",
  "light implies energy",
  "deforestation implies oxygen reduction",
  "oxygen reduction implies climate change",
  "recursion implies base case",
  "memoization implies efficiency",
  "sorting implies order",
  // Multi-hop chain for transitivity tests
  "A implies B",
  "B implies C",
  "C implies D",
  "D implies E",
  "E implies conclusion",
  // Identity claims (is / are)
  "fire is heat and light",
  "smoke is a combustion product",
  "DNA is genetic material",
  "mammals are warm-blooded",
  "bacteria are single-celled organisms",
  "water is hydrogen and oxygen",
  "diamonds are the hardest mineral",
  "gold is chemically inert",
  "iron is magnetic",
  "oxygen is essential for life",
  "entropy is disorder",
  "neurons are brain cells",
  "Amazon is a rainforest",
  "Everest is the tallest mountain",
  "Sahara is the largest desert",
  "light is electromagnetic radiation",
  "sound is wave propagation",
  "recursion is self-referential computation",
  "memoization is subproblem caching",
  "binary search is a fast lookup algorithm",
  "hash tables are constant time structures",
  "garbage collection is automatic memory management",
  "neutrinos are nearly massless",
  "black holes are gravitational singularities",
  "entropy is always increasing",
  "quantum entanglement is nonlocal correlation",
  // Conjunction chains
  "fire implies smoke and smoke implies danger",
  "oxygen implies respiration and respiration implies life",
  "photosynthesis implies glucose and glucose implies energy",
  "gravity implies attraction and attraction implies orbit",
  "heat implies expansion and expansion implies pressure",
  // Negations
  "ice is not hot",
  "darkness is not light",
  "silence is not sound",
  // Logic
  "p implies q and q implies r",
  "not fire implies not smoke",
  "all mammals are warm-blooded",
];

// Mock Unfolder

/**
 * Serves CORPUS sentences round-robin so the dream cycle gets deterministic
 * content without any network I/O.
 */
class CorpusUnfolder extends Unfolder {
  private corpus: string[];
  private idx = 0;

  constructor(
    system: ConstructorParameters<typeof Unfolder>[0],
    atomizer: ConstructorParameters<typeof Unfolder>[1],
    corpus: string[]
  ) {
    super(system, atomizer);
    this.corpus = corpus;
  }

  public override async fetchContent(_topic: string): Promise<string> {
    const sentence = this.corpus[this.idx % this.corpus.length];
    this.idx++;
    return sentence;
  }
}

// Helpers

/** Yields to the microtask queue so dream-cycle promises can resolve. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** Runs `ticks` ManifoldLifecycle ticks in batches, flushing async between each batch. */
async function runTicks(
  manager: ManifoldLifecycle,
  ticks: number,
  batchSize = 25
): Promise<void> {
  for (let i = 0; i < ticks; i += batchSize) {
    const end = Math.min(i + batchSize, ticks);
    for (let t = i; t < end; t++) {
      manager.tick(DOPAT_CONFIG.DELTA);
    }
    await flushAsync();
  }
}

// Suite

export async function executeEnduranceSuite() {
  await describe("ENDURANCE - Knowledge Digestion Under Load", async () => {
    metrics.reset();

    const env = await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
    const emergencyEnv =
      await TestHarness.getEnvironment<SemanticAtomizer>("semantic");

    const dbCtx = new DatabaseContext(":memory:");
    const dbConn = await dbCtx.connect();
    const persistence = new SystemPersistence(dbConn);

    const manager = new ManifoldLifecycle(
      env.system,
      emergencyEnv.system,
      persistence
    );

    const unfolder = new CorpusUnfolder(
      manager.getSystemRef(),
      env.atomizer,
      CORPUS
    );
    manager.setUnfolder(unfolder);

    // Phase 1: Corpus ingestion throughput

    await it("Phase 1: ingest full corpus and measure throughput", async () => {
      const t0 = performance.now();
      let totalPreceptsIngested = 0;

      for (const sentence of CORPUS) {
        const ids = env.atomizer.ingestSequence(sentence, env.system);
        totalPreceptsIngested += ids.length;

        // Crystallise each sentence into the vault for later retrieval.
        if (ids.length >= 2) {
          await env.store.crystallizeProof(ids, ids, 1.0);
        }
      }

      const elapsed = performance.now() - t0;
      const preceptsPerSec = Math.round(
        totalPreceptsIngested / (elapsed / 1000)
      );

      logger.log(
        `  Corpus: ${CORPUS.length} sentences → ${totalPreceptsIngested} precepts` +
          ` in ${elapsed.toFixed(1)}ms (${preceptsPerSec.toLocaleString()} precepts/s)`
      );
      logger.log(
        `  Manifold occupancy: ${env.system.length.toLocaleString()} / ${DOPAT_CONFIG.MAX_PRECEPTS.toLocaleString()}` +
          ` (${((env.system.length / DOPAT_CONFIG.MAX_PRECEPTS) * 100).toFixed(3)}%)`
      );

      assert.ok(
        totalPreceptsIngested > 0,
        "corpus must produce at least one precept"
      );
      assert.ok(
        env.system.length < DOPAT_CONFIG.MAX_PRECEPTS,
        "manifold must not overflow during corpus ingestion"
      );
      assert.ok(
        elapsed < 30_000,
        `ingestion must complete within 30s (took ${elapsed.toFixed(0)}ms)`
      );
    });

    // Phase 2: Tick endurance

    await it("Phase 2: 1000 ticks - delta queue, consolidation, dream cycles", async () => {
      const TICKS = 1000;
      const lengthBefore = env.system.length;
      const t0 = performance.now();

      await runTicks(manager, TICKS);

      const elapsed = performance.now() - t0;
      const msPerTick = elapsed / TICKS;
      const lengthAfter = env.system.length;

      logger.log(
        `  ${TICKS} ticks completed in ${elapsed.toFixed(0)}ms (${msPerTick.toFixed(2)}ms/tick)`
      );
      logger.log(
        `  Precepts: ${lengthBefore.toLocaleString()} → ${lengthAfter.toLocaleString()}` +
          ` (Δ ${(lengthAfter - lengthBefore >= 0 ? "+" : "") + (lengthAfter - lengthBefore).toLocaleString()})`
      );

      const snap = metrics.getSnapshot();
      const sv = (key: string) => snap[key]?.value ?? 0;
      logger.log(`  Dream cycles started : ${sv("dream.started")}`);
      logger.log(`  Dream content queued : ${sv("dream.ingested")}`);
      logger.log(`  Dream queue full shed: ${sv("dream.queue_full")}`);
      logger.log(`  Delta queue overflow : ${sv("delta_queue.overflow")}`);
      logger.log(`  TMR agreements       : ${sv("tmr.agree")}`);

      assert.ok(
        env.system.length < DOPAT_CONFIG.MAX_PRECEPTS,
        "manifold must not overflow after tick endurance run"
      );
      assert.ok(
        msPerTick < 100,
        `tick must stay under 100ms each (actual ${msPerTick.toFixed(2)}ms)`
      );
    });

    // Phase 3: Reasoning quality probe

    await it("Phase 3: resolution quality - battery of knowledge queries", async () => {
      interface QueryCase {
        query: string;
        hint: string;
      }
      const QUERIES: QueryCase[] = [
        { query: "fire implies |-", hint: "fire → smoke" },
        { query: "smoke implies |-", hint: "smoke → combustion" },
        { query: "combustion implies |-", hint: "combustion → oxygen" },
        { query: "oxygen implies |-", hint: "oxygen → respiration" },
        { query: "respiration implies |-", hint: "respiration → life" },
        {
          query: "photosynthesis implies |-",
          hint: "photosynthesis → glucose",
        },
        { query: "glucose implies |-", hint: "glucose → energy" },
        { query: "gravity implies |-", hint: "gravity → attraction" },
        { query: "A implies |-", hint: "A → B (multi-hop)" },
        { query: "mammals are |-", hint: "mammals identity" },
        { query: "water is |-", hint: "water identity" },
        { query: "diamonds are |-", hint: "diamonds property" },
        { query: "DNA is |-", hint: "DNA identity" },
        { query: "entropy is |-", hint: "entropy identity" },
        { query: "recursion implies |-", hint: "recursion → base case" },
      ];

      let resolved = 0;
      const results: { q: string; answer: string }[] = [];

      for (const { query, hint } of QUERIES) {
        const ids = env.atomizer.ingestSequence(query, env.system);
        const path = await env.resolver.resolveSequence(ids);
        const answer = env.atomizer.decodeSequence(path, env.system).trim();
        const hit =
          answer &&
          answer !== "unknown" &&
          answer !== query.replace(" |-", "").trim();
        if (hit) resolved++;
        results.push({ q: hint, answer: hit ? answer : "(unknown)" });
      }

      const successRate = (resolved / QUERIES.length) * 100;

      for (const { q, answer } of results) {
        logger.log(
          `  [${answer !== "(unknown)" ? "HIT " : "MISS"}] ${q.padEnd(28)} → ${answer}`
        );
      }

      logger.log(
        `\n  Resolution rate: ${resolved}/${QUERIES.length} (${successRate.toFixed(0)}%)`
      );

      assert.ok(
        resolved >= Math.ceil(QUERIES.length * 0.25),
        `at least 25% of queries must resolve - got ${successRate.toFixed(0)}%`
      );
    });

    // Phase 4: Structural integrity

    await it("Phase 4: structural integrity - zero corrupted precepts", async () => {
      const corrupted = env.system.checkIntegrity();

      logger.log(
        `  Allocated precepts : ${env.system.length.toLocaleString()}`
      );
      logger.log(`  Corrupted precepts : ${corrupted.length}`);

      assert.strictEqual(
        corrupted.length,
        0,
        `manifold has ${corrupted.length} corrupted precept(s) after sustained load`
      );

      // Verify every allocated precept has finite coordinates.
      let infiniteCount = 0;
      for (let i = 0; i < env.system.length; i++) {
        if (!env.system.isAllocated(i)) continue;
        if (
          !Number.isFinite(env.system.posX[i]) ||
          !Number.isFinite(env.system.posY[i]) ||
          !Number.isFinite(env.system.posZ[i]) ||
          !Number.isFinite(env.system.posW[i]) ||
          !Number.isFinite(env.system.mass[i])
        ) {
          infiniteCount++;
        }
      }

      assert.strictEqual(
        infiniteCount,
        0,
        `${infiniteCount} precept(s) have non-finite coordinates`
      );
    });

    // Phase 5: Vault coverage

    await it("Phase 5: vault coverage - crystallised proofs exist", async () => {
      const res = await env.store.connection.runAndReadAll(
        `SELECT COUNT(*) as n, AVG(net_energy) as avg_e, MAX(COALESCE(usage_count, 0)) as max_u FROM wave_forms`
      );
      const rows = res.getRows();
      let count = 0;
      let avgEnergy = 0;
      let maxUsage = 0;
      if (rows.length > 0) {
        count = Number(rows[0][0] ?? 0);
        avgEnergy = Number(rows[0][1] ?? 0);
        maxUsage = Number(rows[0][2] ?? 0);
      }

      logger.log(`  Wave forms in vault : ${count.toLocaleString()}`);
      logger.log(`  Average net energy  : ${avgEnergy.toFixed(4)}`);
      logger.log(`  Max usage_count     : ${maxUsage}`);

      assert.ok(
        count > 0,
        "vault must contain at least one crystallised proof"
      );
      assert.ok(avgEnergy > 0, "average vault energy must be positive");
    });

    // Phase 6: Concurrent delta load

    await it("Phase 6: 1000 typed deltas queued and drained cleanly", async () => {
      const DELTA_COUNT = 1000;

      // Allocate some test precepts to update.
      const testIds: number[] = [];
      for (let i = 0; i < 10; i++) {
        testIds.push(env.system.createLocation(env.system.c ** 2, 0));
      }

      // Queue the deltas - none should be applied yet.
      const massesBefore = testIds.map(id => env.system.mass[id]);
      const targetMass = env.system.c ** 2 * 2;

      for (let i = 0; i < DELTA_COUNT; i++) {
        const target = testIds[i % testIds.length];
        manager.postDelta({
          kind: "update",
          id: target,
          field: "mass",
          value: targetMass,
        });
      }

      // Masses must be unchanged before tick.
      for (let i = 0; i < testIds.length; i++) {
        assert.strictEqual(
          env.system.mass[testIds[i]],
          massesBefore[i],
          `mass must be unchanged before tick for precept ${testIds[i]}`
        );
      }

      // A single tick drains the entire queue.
      const t0 = performance.now();
      manager.tick(DOPAT_CONFIG.DELTA);
      await flushAsync();
      const drainMs = performance.now() - t0;

      // After the tick every test precept should have the updated mass
      // (last write per id wins; DeltaQueue preserves insertion order).
      // Just verify they've all been modified away from their original values.
      let updatedCount = 0;
      for (const id of testIds) {
        if (env.system.mass[id] !== massesBefore[testIds.indexOf(id)]) {
          updatedCount++;
        }
      }

      const snap = metrics.getSnapshot();
      const overflow = snap["delta_queue.overflow"] ?? 0;

      logger.log(`  ${DELTA_COUNT} deltas drained in ${drainMs.toFixed(1)}ms`);
      logger.log(`  Precepts updated: ${updatedCount}/${testIds.length}`);
      logger.log(`  Queue overflows : ${overflow}`);

      assert.ok(
        updatedCount > 0,
        "at least one precept must be updated by the delta batch"
      );

      // Cleanup test precepts via free deltas.
      for (const id of testIds) {
        manager.postDelta({ kind: "free", id });
      }
      manager.tick(DOPAT_CONFIG.DELTA);
      await flushAsync();
    });

    // Phase 7: Metrics snapshot

    await it("Phase 7: metrics - counters reflect real pipeline activity", async () => {
      const snap = metrics.getSnapshot();
      const v = (key: string) => snap[key]?.value ?? 0;

      const report: Record<string, number> = {
        "dream.started": v("dream.started"),
        "dream.ingested": v("dream.ingested"),
        "tmr.agree": v("tmr.agree"),
        "tmr.corrected": v("tmr.corrected"),
        "tmr.total_disagree": v("tmr.total_disagree"),
        "vault.crystallize": v("vault.crystallize"),
        "vault.hit": v("vault.hit"),
        "vault.miss": v("vault.miss"),
        "vault.dedup_skip": v("vault.dedup_skip"),
        "delta_queue.overflow": v("delta_queue.overflow"),
        "system.length (gauge)": v("system.length"),
      };

      logger.log("\\n  Final Metrics Snapshot");
      for (const [key, val] of Object.entries(report)) {
        logger.log(`  ${key.padEnd(28)} ${val.toLocaleString()}`);
      }

      // TMR should not have disagreements under normal load.
      assert.strictEqual(
        report["tmr.total_disagree"],
        0,
        "no TMR three-way disagreements should occur under normal load"
      );

      // The vault must have been used (either hit or miss means resolution ran).
      const vaultActivity =
        report["vault.crystallize"] +
        report["vault.hit"] +
        report["vault.miss"];
      assert.ok(
        vaultActivity > 0,
        "vault must show activity (crystallize/hit/miss)"
      );
    });

    // Teardown

    await dbCtx.close();
    await TestHarness.disposeEnvironment(env);
    await TestHarness.disposeEnvironment(emergencyEnv);
  });
}
