import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import LiveInference from "@core_i/LiveInference";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import logger from "@utils/SpectralLogger";
import { metrics } from "@core_s/Metrics";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeLiveInferenceSuite() {
  await describe("Testing Live Inference Toolkit", async () => {
    const testDbPath = path.resolve(__dirname, "./test_memory.duckdb");
    try {
      await fs.rm(testDbPath, { force: true });
    } catch {}

    const env = await TestHarness.getEnvironment("semantic", testDbPath);
    const inference = new LiveInference(
      env.system,
      env.atomizer as SemanticAtomizer,
      env.resolver,
      env.store
    );

    const responses: string[] = [];
    inference.respond = (response: string) => {
      responses.push(response);
      logger.log(`[TestInference]: ${response}`);
    };

    // Phase 1, Direct manifold inference (ingestion + immediate recall).
    await it("Command Processing & Persistence", async () => {
      await inference.processIntent("the sky is blue");
      assert.ok(responses.length > 0, "processIntent should emit a response");
      assert.match(
        responses[0],
        /Acknowledged:/,
        "Response should confirm ingestion"
      );
      const decodedFact = responses[0]
        .replace(/Acknowledged:\s*"?/, "")
        .replace(/"$/, "");
      assert.ok(
        decodedFact.includes("sky") && decodedFact.includes("blue"),
        `Ingested fact should contain "sky" and "blue"; got "${decodedFact}"`
      );
      responses.length = 0;
    });

    await it("Question Processing (Known Data), Phase 1 direct inference", async () => {
      await inference.processIntent("What is the sky?");
      assert.ok(responses.length > 0, "Question should produce a response");
      assert.ok(
        responses[0].toLowerCase().includes("blue"),
        `Phase 1 should answer "blue" for "What is the sky?"; got "${responses[0]}"`
      );
      responses.length = 0;
    });

    // Phase 2, Vault cache hit on second query for the same fact.
    await it("Question Processing (Vault Cache), Phase 2 cache hit", async () => {
      const hitsBefore = metrics.getSnapshot()["vault.hit"]?.value ?? 0;

      await inference.processIntent("What is the sky?");

      const hitsAfter = metrics.getSnapshot()["vault.hit"]?.value ?? 0;
      assert.ok(
        hitsAfter > hitsBefore,
        `Repeated query should hit vault cache; hits before=${hitsBefore} after=${hitsAfter}`
      );
      assert.ok(
        responses[0].toLowerCase().includes("blue"),
        `Vault result should still answer "blue"; got "${responses[0]}"`
      );
      responses.length = 0;
    });

    // Phase 3, Unfolder expansion for unknown facts: verify non-null, non-error response.
    await it("Complex Synthesis Question, Phase 3/5 unfolder path", async () => {
      await inference.processIntent("how to make titanium-iridium alloy?");
      assert.ok(
        responses.length > 0,
        "processIntent should always produce a response"
      );

      const fullResponse = responses.join(" ");
      assert.ok(fullResponse.length > 0, "Response must be non-empty");
      assert.ok(
        !fullResponse.toLowerCase().includes("error"),
        `Response must not contain error text; got: "${fullResponse}"`
      );
      // The system either expands via Wikipedia (Phase 5) or returns "unknown" gracefully.
      // Both are valid, the important guarantee is no crash and no error message.
      logger.log(
        `Complex synthesis result length: ${fullResponse.length} chars`
      );
      responses.length = 0;
    });

    await TestHarness.disposeEnvironment(env);
    try {
      await fs.rm(testDbPath, { force: true });
    } catch {}
  });
}
