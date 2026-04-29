import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import LiveInference from "@core_i/LiveInference";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeLiveInferenceSuite() {
  await describe("Testing Live Inference Toolkit", async () => {
    const testDbPath = path.resolve(__dirname, "./test_memory.duckdb");
    try {
      await fs.rm(testDbPath, { force: true });
    } catch (e) {}

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

    await it("Command Processing & Persistence", async () => {
      await inference.processIntent("the sky is blue");
      assert.ok(responses.length > 0);
      assert.match(responses[0], /Acknowledged:/);
      responses.length = 0;
    });

    await it("Question Processing (Known Data)", async () => {
      await inference.processIntent("What is the sky?");
      assert.ok(responses[0].includes("blue"));
      responses.length = 0;
    });

    await it("Complex Synthesis Question", async () => {
      await inference.processIntent("how to make titanium-iridium alloy?");
      assert.ok(responses.length > 0);
      // Currently this will fail to find an answer and return "unknown"
      // we just want to ensure it completes execution for the plan phase.
      responses.length = 0;
    });

    await TestHarness.disposeEnvironment(env);
    try {
      await fs.rm(testDbPath, { force: true });
    } catch (e) {}
  });
}
