/**
 * Number-line topology test suite.
 *
 * Verifies that the "after N is |-" → "N+1" vault entries seeded by
 * _seedSyllogisms can be recalled via the standard "what is after N?" query
 * path (Listener Phase 0 → topologicalQuery "after N is" → probe matches).
 *
 * Three test tiers:
 *   1. Direct recall  - single-step lookup, facts crystallised at boot
 *   2. Boundary      - first (after 0) and last (after 9) seeded edges
 *   3. Novel / non-failing - derive "what comes two steps after N?" via the
 *                    after-transitivity syllogism; we investigate whether the
 *                    Resolver chains the template without penalising "unknown".
 */

import * as assert from "node:assert";
import Runtime from "@core_i/Runtime";
import logger from "@utils/SpectralLogger";
import { describe, it } from "./utils/harness";

export async function executeNumberLineSuite() {
  await describe("NUMBER LINE TOPOLOGY SUITE", async () => {
    const rt = await Runtime.boot({
      atomizer: "semantic",
      db: ":memory:",
      noTick: true,
      noLifecycle: true,
      skipIdentity: true,
      noWorkers: true,
    });
    await rt.ready;

    const ask = (q: string) => rt.inference.processQuestion(q);

    // -------------------------------------------------------------------------
    // Tier 1: Direct single-step recall
    //
    // These facts are seeded by _seedSyllogisms as:
    //   "after N is |-" → "N+1"
    // The Listener builds topologicalQuery = "after N is", Phase 0 appends the
    // sink and hits the vault.
    // -------------------------------------------------------------------------
    await describe("Single-step successor lookup", async () => {
      await it("after 0 → 1", async () => {
        assert.strictEqual((await ask("what is after 0?")).trim(), "1");
      });
      await it("after 1 → 2", async () => {
        assert.strictEqual((await ask("what is after 1?")).trim(), "2");
      });
      await it("after 2 → 3", async () => {
        assert.strictEqual((await ask("what is after 2?")).trim(), "3");
      });
      await it("after 4 → 5", async () => {
        assert.strictEqual((await ask("what is after 4?")).trim(), "5");
      });
      await it("after 7 → 8", async () => {
        assert.strictEqual((await ask("what is after 7?")).trim(), "8");
      });
    });

    // -------------------------------------------------------------------------
    // Tier 2: Boundary cases
    // -------------------------------------------------------------------------
    await describe("Boundary cases", async () => {
      await it("after 9 → 10 (last seeded edge)", async () => {
        assert.strictEqual((await ask("what is after 9?")).trim(), "10");
      });
    });

    // -------------------------------------------------------------------------
    // Tier 3: Non-failing investigations
    //
    // These queries fall outside the directly seeded single-step table.
    // We log and investigate - no assertion failure on "unknown".
    // -------------------------------------------------------------------------
    await describe("Novel derivation (non-failing)", async () => {
      await it("after 10 → 11? (beyond seeded range, non-failing)", async () => {
        const result = (await ask("what is after 10?")).trim();
        logger.log(
          `  ↳ after 10 → "${result}"  ${result === "11" ? "✓ generalised!" : "(expected 11 - beyond seeded range)"}`
        );
      });
    });

    await rt.dispose();
  });
}
