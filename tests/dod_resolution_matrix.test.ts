import assert from "node:assert/strict";
import logger from "@src/utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeLogicSuite() {
  await describe("DOD Resolution Matrix Suite", async () => {
    const env = await TestHarness.getEnvironment("base");

    // 1. Pre-ingest semantic facts into the global system buffer
    const semanticKnowledge = [
      "the sky is blue",
      "the grass is green",
      "fire is hot",
      "water is wet",
      "ice is cold",
      "sun is bright",
      "birds can fly",
      "fish can swim",
      "humans can think",
    ];

    await it("Pre-ingest semantic facts into buffer", async () => {
      for (const fact of semanticKnowledge) {
        env.atomizer.ingestSequence(fact, env.system);
      }
    });

    const axioms = {
      deduction: [
        { input: "p implies q && p |-", target: "q" },
        { input: "a implies b && a |-", target: "b" },
        { input: "x implies y && x |-", target: "y" },
        { input: "u implies v && u |-", target: "v" },
        { input: "a implies b && b implies c |-", target: "a implies c" },
        { input: "x implies y && y implies z |-", target: "x implies z" },
        { input: "u implies v && v implies w |-", target: "u implies w" },
        { input: "j implies k && k implies l |-", target: "j implies l" },
        { input: "all a are b && all b are c |-", target: "all a are c" },
        { input: "all m are n && s is m |-", target: "s is n" },
        { input: "all x are y && z is x |-", target: "z is y" },
        { input: "for all x exists y |-", target: "y" },
        { input: "for all a exists b |-", target: "b" },
      ],
      semantic: [
        { input: "the sky is", target: "blue" },
        { input: "the grass is", target: "green" },
        { input: "fire is", target: "hot" },
        { input: "water is", target: "wet" },
        { input: "ice is", target: "cold" },
        { input: "sun is", target: "bright" },
        { input: "birds can", target: "fly" },
        { input: "fish can", target: "swim" },
        { input: "humans can", target: "think" },
      ],
    };

    await it("Testing Deduction (Local system evaluation)", async () => {
      for (const axiom of axioms.deduction) {
        const ids = env.atomizer.ingestSequence(axiom.input, env.system);
        const resolvedIds = await env.resolver.resolveSequence(ids);
        const resultString = env.atomizer
          .decodeSequence(resolvedIds, env.system)
          .replace(/\s+/g, " ")
          .trim();

        assert.strictEqual(
          resultString,
          axiom.target,
          `Physics Drift: Expected '${axiom.target}', Computed '${resultString}'`
        );
      }
    });

    await it("Testing Semantics (Global buffer querying)", async () => {
      for (const axiom of axioms.semantic) {
        const ids = env.atomizer.ingestSequence(axiom.input, env.system);
        const resolvedIds = await env.resolver.resolveSequence(ids);
        const resultString = env.atomizer
          .decodeSequence(resolvedIds, env.system)
          .replace(/\s+/g, " ")
          .trim();

        assert.strictEqual(
          resultString,
          axiom.target,
          `Memory Fault: Expected '${axiom.target}', Computed '${resultString}'`
        );
      }
    });

    const complexChecks = [
      { input: "p implies q && q implies r |-", target: "p implies r" },
      { input: "a implies b && b implies c |-", target: "a implies c" },
      { input: "x implies y && y implies z |-", target: "x implies z" },
      { input: "all a are b && all b are c |-", target: "all a are c" },
      { input: "u implies v && v implies w |-", target: "u implies w" },
      { input: "j implies k && k implies l |-", target: "j implies l" },
    ];

    await it("Testing Complex Deduction Pass", async () => {
      for (const check of complexChecks) {
        const ids = env.atomizer.ingestSequence(check.input, env.system);
        const resolvedIds = await env.resolver.resolveSequence(ids);
        const resultString = env.atomizer
          .decodeSequence(resolvedIds, env.system)
          .replace(/\s+/g, " ")
          .trim();

        assert.strictEqual(
          resultString,
          check.target,
          `Physics Drift: Expected '${check.target}', Computed '${resultString}'`
        );
      }
    });

    await TestHarness.disposeEnvironment(env);
    logger.log("\nALL TESTS PASSED: DOD Physics Engine verified.");
  });
}
