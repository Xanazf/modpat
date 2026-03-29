import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeSemanticSuite() {
  await describe("Semantic Atomizer Suite", async () => {
    const env = await TestHarness.getEnvironment("semantic");

    await it("Testing Embedding Semantic Closeness", async () => {
      // Ingest single words to avoid grouping
      const id1 = env.atomizer.ingestSequence("invented", env.system)[0];
      const id2 = env.atomizer.ingestSequence("discovered", env.system)[0];
      const id3 = env.atomizer.ingestSequence("electricity", env.system)[0];

      const dist = (i1: number, i2: number) => {
        const dx = env.system.posX[i1] - env.system.posX[i2];
        const dy = env.system.posY[i1] - env.system.posY[i2];
        const dz = env.system.entropy[i1] - env.system.entropy[i2];
        const dw = env.system.time[i1] - env.system.time[i2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
      };

      const distInvDisc = dist(id1, id2);
      const distInvElec = dist(id1, id3);

      logger.log(`Distance Invented-Discovered: ${distInvDisc.toFixed(4)}`);
      logger.log(`Distance Invented-Electricity: ${distInvElec.toFixed(4)}`);

      assert.ok(
        distInvDisc < distInvElec,
        "Invented should be closer to Discovered than to Electricity"
      );
    });

    await it("Testing Abstract Semantic Derivation", async () => {
      // INGEST ABSTRACT SEMANTIC KNOWLEDGE
      env.atomizer.ingestSequence("invented implies creation", env.system);
      env.atomizer.ingestSequence("discovered implies creation", env.system);

      // TEST DERIVATION 1
      const testString1 = "if in 1827 Nikola Tesla invented electricity";
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
      const testString2 = "if in 1905 Albert Einstein discovered relativity";
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

      const testString = "if in 1827 Nikola Tesla studied electricity";
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

    await it("Testing Basic Sentence Ingestion", async () => {
      const testString = "in 1827 Nikola Tesla invented electricity";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      assert.strictEqual(ids.length, 5);
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

    await it("Testing Complex Entity Ingestion", async () => {
      const testString = "The United States of America is a large country";
      const ids = env.atomizer.ingestSequence(testString, env.system);
      assert.ok(ids.length > 0);
    });

    await TestHarness.disposeEnvironment(env);
  });
}
