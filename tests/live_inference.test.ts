import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import { createTestTraveler } from "@core_i/Runtime";
import Traveler from "@core_i/Traveler";
import { metrics } from "@core_s/Metrics";
import QueryDecomposer from "@mutate/QueryDecomposer";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeLiveInferenceSuite() {
  await describe("Testing Live Inference Toolkit", async () => {
    const testDbPath = path.resolve(__dirname, "./test_memory.duckdb");
    try {
      await fs.rm(testDbPath, { force: true });
    } catch {}

    const env = await TestHarness.getEnvironment("semantic", testDbPath);
    const inference = createTestTraveler(
      env.system,
      env.atomizer,
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
    // Note: `inference` has no Unfolder or QueryDecomposer wired, so the compound
    // pre-pass is bypassed.  This test is a no-crash / graceful-unknown smoke test.
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

    // -------------------------------------------------------------------------
    // QueryDecomposer unit tests
    //
    // These use the live Language instance wired to `inference` so that the real
    // NLP pipeline (compromise tokenisation, heat-node extraction) is exercised.
    // No network calls are made; the decomposer is pure structure analysis.
    // -------------------------------------------------------------------------

    await it("QueryDecomposer: alloy query is detected as compound", async () => {
      const decomposer = new QueryDecomposer();
      const ir = inference.language!.ingest(
        "how to make titanium-iridium alloy?"
      );
      assert.ok(
        decomposer.isCompound(ir),
        `isCompound should be true for the alloy query; ` +
          `heatNodes=${JSON.stringify(ir.heatNodes)}, intent=${ir.intent}`
      );
    });

    await it("QueryDecomposer: alloy query decomposes into ordered prerequisites", async () => {
      const decomposer = new QueryDecomposer();
      const query = "how to make titanium-iridium alloy?";
      const ir = inference.language!.ingest(query);
      const sqs = decomposer.decompose(query, ir);

      logger.log(
        `[Decomposer] sub-queries: ${sqs.map(s => `"${s.text}"`).join(", ")}`
      );

      assert.ok(
        sqs.length >= 3,
        `Expected ≥3 sub-queries; got ${sqs.length}: ${JSON.stringify(sqs.map(s => s.text))}`
      );

      const texts = sqs.map(s => s.text);

      assert.ok(
        texts.some(t => t.includes("titanium")),
        `Expected a "titanium" entity lookup; got ${JSON.stringify(texts)}`
      );
      assert.ok(
        texts.some(t => t.includes("iridium")),
        `Expected an "iridium" entity lookup; got ${JSON.stringify(texts)}`
      );
      assert.ok(
        texts.some(t => t.includes("alloy")),
        `Expected an "alloy" lookup; got ${JSON.stringify(texts)}`
      );

      // Entity lookups (what is X?) must all precede the process lookup (how to V N?)
      const entityIdxs = texts
        .map((t, i) => (t.startsWith("what is") ? i : -1))
        .filter(i => i >= 0);
      const processIdx = texts.findIndex(t => t.startsWith("how to"));
      if (processIdx >= 0 && entityIdxs.length > 0) {
        assert.ok(
          entityIdxs.every(i => i < processIdx),
          `Entity lookups should come before the process lookup; ` +
            `order=${JSON.stringify(texts)}`
        );
      }

      // Purpose strings are well-formed
      for (const sq of sqs) {
        assert.ok(
          sq.purpose.startsWith("understand_entity:") ||
            sq.purpose.startsWith("understand_process:"),
          `Unexpected purpose format: "${sq.purpose}"`
        );
      }
    });

    await it("QueryDecomposer: simple single-entity query is not compound", async () => {
      const decomposer = new QueryDecomposer();
      const ir = inference.language!.ingest("what is the sky?");
      assert.ok(
        !decomposer.isCompound(ir),
        `isCompound should be false for "what is the sky?"; ` +
          `heatNodes=${JSON.stringify(ir.heatNodes)}`
      );
    });

    await it("QueryDecomposer: assertion is never compound", async () => {
      const decomposer = new QueryDecomposer();
      const ir = inference.language!.ingest("the sky is blue");
      assert.strictEqual(
        ir.intent,
        "assertion",
        `"the sky is blue" should parse as assertion; got "${ir.intent}"`
      );
      assert.ok(
        !decomposer.isCompound(ir),
        "Assertions must never be compound"
      );
    });

    // -------------------------------------------------------------------------
    // Compound pre-pass integration tests (mock Unfolder)
    //
    // Each test creates a fresh Traveler with a QueryDecomposer and a lightweight
    // mock Unfolder that records which topics it was asked to expand.  No actual
    // Wikipedia fetches occur.  We verify that the pre-pass fires and calls the
    // Unfolder once per sub-query for a compound query, and never fires for a
    // simple query.
    //
    // A separate Traveler is used so these tests don't share intent / position
    // state with the Phase 1–3 `inference` instance.
    // -------------------------------------------------------------------------

    await it("Compound pre-pass: calls Unfolder for each prerequisite topic", async () => {
      const expandedTopics: string[] = [];
      const mockUnfolder = {
        expand: async (_id: number, topic?: string) => {
          if (topic) expandedTopics.push(topic);
          // Return false so _resolveSubQuery treats the topic as still unknown
          // and always calls expand (rather than short-circuiting on a cached hit).
          return false;
        },
      } as any;

      const freshTraveler = createTestTraveler(
        env.system,
        env.atomizer,
        new Traveler(env.system, env.atomizer, env.store),
        env.store
      );
      freshTraveler.setDecomposer(new QueryDecomposer());
      freshTraveler.setUnfolder(mockUnfolder);

      await freshTraveler.process("how to make titanium-iridium alloy?");

      logger.log(
        `[PrePass] Unfolder was called for: ${JSON.stringify(expandedTopics)}`
      );

      assert.ok(
        expandedTopics.length >= 3,
        `Pre-pass should expand ≥3 prerequisite topics; ` +
          `got ${expandedTopics.length}: ${JSON.stringify(expandedTopics)}`
      );
      assert.ok(
        expandedTopics.some(t => t.toLowerCase().includes("titanium")),
        `Unfolder should expand the "titanium" prerequisite; ` +
          `got ${JSON.stringify(expandedTopics)}`
      );
      assert.ok(
        expandedTopics.some(t => t.toLowerCase().includes("iridium")),
        `Unfolder should expand the "iridium" prerequisite; ` +
          `got ${JSON.stringify(expandedTopics)}`
      );
    });

    await it("Compound pre-pass: simple question does not call Unfolder", async () => {
      const expandedTopics: string[] = [];
      const mockUnfolder = {
        expand: async (_id: number, topic?: string) => {
          if (topic) expandedTopics.push(topic);
          return false;
        },
      } as any;

      const freshTraveler = createTestTraveler(
        env.system,
        env.atomizer,
        new Traveler(env.system, env.atomizer, env.store),
        env.store
      );
      freshTraveler.setDecomposer(new QueryDecomposer());
      freshTraveler.setUnfolder(mockUnfolder);

      await freshTraveler.process("what is the sky?");

      assert.strictEqual(
        expandedTopics.length,
        0,
        `Simple query must not trigger the compound pre-pass; ` +
          `Unfolder was called with ${JSON.stringify(expandedTopics)}`
      );
    });

    await TestHarness.disposeEnvironment(env);
    try {
      await fs.rm(testDbPath, { force: true });
    } catch {}
  });
}
