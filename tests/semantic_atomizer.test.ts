import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeSemanticSuite() {
  await describe("Semantic Atomizer Suite", async () => {
    const env = await TestHarness.getEnvironment("semantic");

    await it("Testing Embedding Semantic Closeness", async () => {
      // Ingest single words to avoid grouping
      const id1 = env.atomizer.ingestSequence("king", env.system)[0];
      const id2 = env.atomizer.ingestSequence("queen", env.system)[0];
      const id3 = env.atomizer.ingestSequence("apple", env.system)[0];

      // Semantic closeness is represented by the Matter Coordinate (posX)
      const dist = (i1: number, i2: number) => {
        return Math.abs(env.system.posX[i1] - env.system.posX[i2]);
      };

      const distKingQueen = dist(id1, id2);
      const distKingApple = dist(id1, id3);

      logger.log(`Distance King-Queen: ${distKingQueen.toFixed(4)}`);
      logger.log(`Distance King-Apple: ${distKingApple.toFixed(4)}`);

      assert.ok(
        distKingQueen < distKingApple,
        "King should be closer to Queen than to Apple"
      );
    });

    await it("Testing Abstract Semantic Derivation", async () => {
      // INGEST ABSTRACT SEMANTIC KNOWLEDGE
      env.atomizer.ingestSequence("invented implies creation", env.system);
      env.atomizer.ingestSequence("discovered implies creation", env.system);

      // TEST DERIVATION 1
      const testString1 = "if in 1827 Nikola Tesla invented electricity |-";
      const ids1 = env.atomizer.ingestSequence(testString1, env.system);
      const resolvedIds1 = await env.resolver.resolveSequence(ids1);
      const resultString1 = env.atomizer.decodeSequence(
        resolvedIds1,
        env.system
      );

      assert.strictEqual(
        resultString1,
        "then electricity did not exist before 1827",
        `Generic derivation failed`
      );

      // TEST DERIVATION 2
      const testString2 = "if in 1905 Albert Einstein discovered relativity |-";
      const ids2 = env.atomizer.ingestSequence(testString2, env.system);
      const resolvedIds2 = await env.resolver.resolveSequence(ids2);
      const resultString2 = env.atomizer.decodeSequence(
        resolvedIds2,
        env.system
      );

      assert.strictEqual(
        resultString2,
        "then relativity did not exist before 1905",
        `Generic derivation failed`
      );
    });

    await it("Testing Destructive Interference (Negation)", async () => {
      env.atomizer.ingestSequence("invented implies creation", env.system);
      env.atomizer.ingestSequence(
        "in 1827 Nikola Tesla invented electricity",
        env.system
      );

      const testString = "if in 1827 Nikola Tesla studied electricity |-";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      const resolvedIds = await env.resolver.resolveSequence(ids);
      const resultString = env.atomizer.decodeSequence(resolvedIds, env.system);

      assert.strictEqual(
        resultString,
        "then nikola tesla did not study electricity",
        `Destructive interference failed`
      );
    });

    await it("Testing Unsupported Inference (Void)", async () => {
      const testString = "Albert Einstein and Nikola Tesla liked pie |-";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      const resolvedIds = await env.resolver.resolveSequence(ids);
      const resultString = env.atomizer.decodeSequence(resolvedIds, env.system);

      assert.strictEqual(resultString, "unknown");
    });

    await it("Testing Basic Sentence Ingestion (Tesla)", async () => {
      const testString = "in 1827 Nikola Tesla invented electricity";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      // "in", "1827", "Nikola Tesla", "invented", "electricity"
      assert.ok(ids.length >= 4);
    });

    await it("Testing Empty/Whitespace Input", async () => {
      assert.strictEqual(env.atomizer.ingestSequence("", env.system).length, 0);
      assert.strictEqual(
        env.atomizer.ingestSequence("   ", env.system).length,
        0
      );
    });

    await it("Testing Punctuation Handling", async () => {
      const testString = "I run to the store. The store is closed.";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      assert.ok(ids.length > 0);
    });

    await it("Testing Explicit Negation Ingestion", async () => {
      const testString = "He did not go to the park";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      assert.ok(ids.length > 0);
    });

    await it("Testing Basic Sentence Ingestion (USA)", async () => {
      const testString = "The United States of America is a large country";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      // "United States of America", "is", "a large country"
      assert.ok(ids.length >= 3);
    });

    await TestHarness.disposeEnvironment(env);
  });
}
