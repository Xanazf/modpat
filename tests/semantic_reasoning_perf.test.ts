import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeComplexSemanticSuite() {
  await describe("Complex Semantic Reasoning & Performance", async () => {
    const dbPath = path.resolve(__dirname, "./reasoning_test.duckdb");
    const env = await TestHarness.getEnvironment("semantic", dbPath);

    await it("Complex semantic reasoning and fuzzy matching", async () => {
      logger.step("Knowledge Ingestion: Fire properties");
      const idsFire = env.atomizer.ingestSequence(
        "fire is hot and red",
        env.system
      );
      for (const id of idsFire) {
        env.system.posZ[id] = 0.2; // Low depth
        env.system.update(id);
      }

      logger.step("Knowledge Ingestion: Mars similarity");
      const idsMars = env.atomizer.ingestSequence(
        "Mars is the red planet",
        env.system
      );
      for (const id of idsMars) {
        env.system.mass[id] *= 5.0; // Massive planetary body
        env.system.posZ[id] = 0.9; // High logic depth
        env.system.update(id);
      }

      logger.step("Query: What is Mars?");
      const query = "Mars is";
      const ids = env.atomizer.ingestSequence(query, env.system);
      const resolvedIds = await env.resolver.resolveSequence(ids);
      const result = env.atomizer.decodeSequence(resolvedIds, env.system);
      logger.log(`Mars lookup: "${result}"`);

      if (result.includes("similar to")) {
        const similarTo = result.replace("similar to", "").trim();
        logger.step(
          `Multi-hop reasoning: Resolving properties for "${similarTo}"`
        );
        const hopQuery = `${similarTo} is`;
        const hopIds = env.atomizer.ingestSequence(hopQuery, env.system);
        const hopResolvedIds = await env.resolver.resolveSequence(hopIds);
        const finalResult = env.atomizer.decodeSequence(
          hopResolvedIds,
          env.system
        );
        logger.log(`Inferred for Mars via ${similarTo}: "${finalResult}"`);
      }

      logger.step("Query: What is the red planet?");
      // "red planet" is semantically close to "Mars" in GloVe
      const fuzzyQuery = "the red planet is";
      const fuzzyIds = env.atomizer.ingestSequence(fuzzyQuery, env.system);

      const fuzzyResolvedIds = await env.resolver.resolveSequence(fuzzyIds);
      const fuzzyResult = env.atomizer.decodeSequence(
        fuzzyResolvedIds,
        env.system
      );
      const bestIdentity = fuzzyResult.split(" ")[0];

      logger.log(`Fuzzy reasoning for "red planet": "${bestIdentity}"`);
      assert.strictEqual(
        bestIdentity.toLowerCase(),
        "mars",
        `Fuzzy reasoning failed to identify "Mars" as the red planet. Got: ${bestIdentity}`
      );
    });

    await it("Performance Benchmark: DuckDB vs GloVe", async () => {
      const ids = env.atomizer.ingestSequence("the sky is blue", env.system);
      await env.store.crystallizeProof(ids.slice(0, 3), ids.slice(3), 1.0);

      const iterations = 100; // Lowered for standard test run
      const gloveStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        // @ts-expect-error - benchmark
        env.atomizer.loader.getScope("electricity");
      }
      const gloveTime = (performance.now() - gloveStart) / iterations;

      const dbStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        await env.store.checkInterferencePattern(ids.slice(0, 3));
      }
      const dbTime = (performance.now() - dbStart) / iterations;

      logger.log(`UMAP: ${gloveTime.toFixed(4)}ms, DB: ${dbTime.toFixed(4)}ms`);
    });

    await TestHarness.disposeEnvironment(env);
    try {
      await fs.rm(dbPath, { force: true });
    } catch (e) {}
  });
}
