/**
 * Arithmetic reasoning test suite.
 *
 * Fact selection constraint for non-commutative operations (-, /):
 *   The vault anchor for "A op B" is proportional to posX[A]+posX[B] = 2(A+B).
 *   Two facts with the same operand sum collide in the vault and the dedup
 *   merges them.  To avoid this, every fact within a section must have a
 *   UNIQUE operand sum.  For commutative ops (+, ×) this is not needed:
 *   "1+2" and "2+1" intentionally share a centroid (they represent the same
 *   fact), which we verify as a commutativity test.
 *
 * Novel-equation tests at the end of each section are non-failing: we
 * investigate whether the system generalises, but do not penalise
 * "unknown" - the current architecture requires explicit teaching.
 */

import Runtime from "@core_i/Runtime";
import logger from "@utils/SpectralLogger";
import * as assert from "assert";
import { describe, it } from "./utils/harness";

export async function executeArithmeticSuite() {
  await describe("ARITHMETIC REASONING SUITE", async () => {
    const rt = await Runtime.boot({
      atomizer: "semantic",
      db: ":memory:",
      noTick: true,
      noLifecycle: true,
      skipIdentity: true,
      noWorkers: true,
    });
    await rt.ready;

    const teach = (fact: string) => rt.inference.processCommand(fact);
    const ask = (q: string) => rt.inference.processQuestion(q);

    // -------------------------------------------------------------------------
    // ADDITION  - comprehensive single-digit table
    //
    // Teach every canonical (A, B) pair with A ≤ B and A+B ≤ 9.
    // That covers the entire addition table up to sum = 9 in 19 facts.
    //
    // Dedup note: pairs with the same sum (e.g. 1+4=5 and 2+3=5) get the
    // same vault anchor - but they also have the same result, so the dedup
    // just keeps the target "5" either way.  No correctness issue.
    //
    // Three test tiers after teaching:
    //   1. Direct recall  - facts exactly as taught (must pass)
    //   2. Commutativity  - B+A when only A+B was taught (must pass, because
    //                        commutativity gives a shared centroid for free)
    //   3. Novel / extrapolation - sums > 9, never stored anywhere:
    //                        theory predicts "unknown"; if physics generalises
    //                        it would return the correct answer (non-failing).
    // -------------------------------------------------------------------------
    await describe("Addition  (+)", async () => {
      // Complete canonical table: A ≤ B, A+B ≤ 9, plus 5+5=10 so the manifold
      // sees at least one two-digit result and can anchor the "10" neighbourhood.
      for (const f of [
        // -- Single-digit canonical table (A ≤ B, A+B ≤ 9) ------------------
        "1+1=2",
        "1+2=3",
        "1+3=4",
        "1+4=5",
        "1+5=6",
        "1+6=7",
        "1+7=8",
        "1+8=9",
        "2+2=4",
        "2+3=5",
        "2+4=6",
        "2+5=7",
        "2+6=8",
        "2+7=9",
        "3+3=6",
        "3+4=7",
        "3+5=8",
        "3+6=9",
        "4+4=8",
        "4+5=9",
        // -- Decade anchor: first two-digit result ---------------------------
        "5+5=10",
        // -- Sums that equal 11 - multiple representations of the same result -
        "10+1=11",
        "9+2=11",
        "8+3=11",
        "7+4=11",
        "6+5=11",
        // -- Decade structure: 10+N for N=2..9 ------------------------------
        // Teaching what "moving past 9" looks like so the manifold sees the
        // single → double digit boundary from multiple entry angles.
        "10+2=12",
        "10+3=13",
        "10+4=14",
        "10+5=15",
        "10+6=16",
        "10+7=17",
        "10+8=18",
        "10+9=19",
        // -- Counting through the teens --------------------------------------
        // N+1 for N=11..19: shows the system how to advance within a decade.
        "11+1=12",
        "12+1=13",
        "13+1=14",
        "14+1=15",
        "15+1=16",
        "16+1=17",
        "17+1=18",
        "18+1=19",
        "19+1=20",
        // -- Two-decade anchor -----------------------------------------------
        "10+10=20",
        "11+10=21",
        "12+10=22",
      ]) {
        await teach(f);
      }

      // -- Tier 1: Direct recall ----------------------------------------------
      await it("1+1 = 2", async () => {
        assert.strictEqual((await ask("what is 1+1?")).trim(), "2");
      });
      await it("1+8 = 9", async () => {
        assert.strictEqual((await ask("what is 1+8?")).trim(), "9");
      });
      await it("2+7 = 9", async () => {
        assert.strictEqual((await ask("what is 2+7?")).trim(), "9");
      });
      await it("3+6 = 9", async () => {
        assert.strictEqual((await ask("what is 3+6?")).trim(), "9");
      });
      await it("4+5 = 9", async () => {
        assert.strictEqual((await ask("what is 4+5?")).trim(), "9");
      });
      await it("2+5 = 7", async () => {
        assert.strictEqual((await ask("what is 2+5?")).trim(), "7");
      });
      await it("3+4 = 7", async () => {
        assert.strictEqual((await ask("what is 3+4?")).trim(), "7");
      });
      await it("4+4 = 8", async () => {
        assert.strictEqual((await ask("what is 4+4?")).trim(), "8");
      });

      // -- Tier 2: Commutativity - B+A not explicitly taught -----------------
      // These work because "A+B" and "B+A" share a centroid (posX sums commute).
      await it("3+1 = 4 (commutative of 1+3, not taught)", async () => {
        assert.strictEqual((await ask("what is 3+1?")).trim(), "4");
      });
      await it("4+3 = 7 (commutative of 3+4, not taught)", async () => {
        assert.strictEqual((await ask("what is 4+3?")).trim(), "7");
      });
      await it("5+4 = 9 (commutative of 4+5, not taught)", async () => {
        assert.strictEqual((await ask("what is 5+4?")).trim(), "9");
      });
      await it("8+1 = 9 (commutative of 1+8, not taught)", async () => {
        assert.strictEqual((await ask("what is 8+1?")).trim(), "9");
      });
      await it("7+2 = 9 (commutative of 2+7, not taught)", async () => {
        assert.strictEqual((await ask("what is 7+2?")).trim(), "9");
      });
      await it("6+3 = 9 (commutative of 3+6, not taught)", async () => {
        assert.strictEqual((await ask("what is 6+3?")).trim(), "9");
      });

      // -- Tier 3: Novel - sum > 9 (never stored, centroid outside trained range)
      // The vault nearest-neighbour cannot reach these: the closest stored
      // anchor is always dx² = 0.25 > VAULT_QUERY_THRESHOLD (0.1).
      // If manifold physics generalises, the correct answer appears; otherwise
      // "unknown".  Non-failing - we log and investigate.
      await it("5+5 = 10 (two-digit result, directly taught)", async () => {
        assert.strictEqual((await ask("what is 5+5?")).trim(), "10");
      });
      // Literal signatures let multiple facts with the same result (all =11)
      // coexist cleanly - "10 plus 1 equals |-" vs "9 plus 2 equals |-" are
      // distinct keys; no spatial collision.
      await it("10+1 = 11", async () => {
        assert.strictEqual((await ask("what is 10+1?")).trim(), "11");
      });
      await it("9+2 = 11", async () => {
        assert.strictEqual((await ask("what is 9+2?")).trim(), "11");
      });
      await it("8+3 = 11", async () => {
        assert.strictEqual((await ask("what is 8+3?")).trim(), "11");
      });
      await it("10+2 = 12", async () => {
        assert.strictEqual((await ask("what is 10+2?")).trim(), "12");
      });
      // -- Tier 3b: Derived via counting chain (bridge + successor axioms) ----
      // These sums were never explicitly taught.  The system derives them via:
      //   bridge seed:    "6 plus 6 equals |-"  →  "11 plus 1"
      //   successor seed: "11 plus 1 equals |-" →  "12"
      //   chain resolver: returns "12"
      // This is the digital equivalent of showing fingers:
      //   "6 and 6 is the same as 11 and 1 more - and 11 and 1 more is 12."
      await it("6+6 = 12 (derived: bridge→successor chain, never directly taught)", async () => {
        assert.strictEqual((await ask("what is 6+6?")).trim(), "12");
      });
      await it("7+7 = 14 (derived: bridge→successor chain, never directly taught)", async () => {
        assert.strictEqual((await ask("what is 7+7?")).trim(), "14");
      });
      await it("8+8 = 16 (derived: bridge→successor chain, never directly taught)", async () => {
        assert.strictEqual((await ask("what is 8+8?")).trim(), "16");
      });
      await it("9+6 = 15 (derived: commutative bridge, never directly taught)", async () => {
        assert.strictEqual((await ask("what is 9+6?")).trim(), "15");
      });

      // -- Tier 3c: Two-digit first operand - bridge now covers a=10..20 -----
      // These use the extended bridge + successor chain seeded at boot:
      //   "12 plus 3 equals |-" → "14 plus 1"  (bridge, a=12)
      //   "14 plus 1 equals |-" → "15"           (successor, n=14)
      await it("12+3 = 15 (two-digit + single-digit, bridge→successor)", async () => {
        assert.strictEqual((await ask("what is 12+3?")).trim(), "15");
      });
      await it("13+4 = 17 (bridge→successor, not directly taught)", async () => {
        assert.strictEqual((await ask("what is 13+4?")).trim(), "17");
      });
      await it("13+8 = 21 (crosses decade boundary, bridge a=13)", async () => {
        assert.strictEqual((await ask("what is 13+8?")).trim(), "21");
      });
      await it("14+7 = 21 (commutative of 7+14, bridge a=14)", async () => {
        assert.strictEqual((await ask("what is 14+7?")).trim(), "21");
      });
      await it("15+6 = 21 (bridge→successor, crosses decade boundary)", async () => {
        assert.strictEqual((await ask("what is 15+6?")).trim(), "21");
      });
      await it("19+8 = 27 (bridge a=19, successor n=26)", async () => {
        assert.strictEqual((await ask("what is 19+8?")).trim(), "27");
      });
      await it("20+5 = 25 (bridge a=20, successor n=24)", async () => {
        assert.strictEqual((await ask("what is 20+5?")).trim(), "25");
      });

      // -- Tier 3d: Beyond seeded bridge range - non-failing investigation ---
      // a > 20: no bridge seeded, no chain path exists.
      // Logs whether the manifold extrapolates the carry rule independently.
      await it("novel: 21+5=? (a=21 > bridge max, non-failing)", async () => {
        const result = (await ask("what is 21+5?")).trim();
        logger.log(
          `  ↳ 21+5=? → "${result}"  ${result === "26" ? "✓ extrapolated!" : "(expected 26 - beyond bridge range)"}`
        );
      });
    });

    // -------------------------------------------------------------------------
    // SUBTRACTION  (non-commutative)
    // Operand sums: 4, 8, 11, 12, 13  (all unique - no dedup collisions)
    // "5-3" (sum 8) was avoided in favour of "6-2" because "5-3" would share
    // sum 8 with "6-2" and they would merge in the vault.
    // -------------------------------------------------------------------------
    await describe("Subtraction  (−)", async () => {
      for (const f of ["3-1=2", "6-2=4", "7-4=3", "9-3=6", "8-5=3"])
        await teach(f);

      await it("3-1 = 2", async () => {
        assert.strictEqual((await ask("what is 3-1?")).trim(), "2");
      });
      await it("6-2 = 4", async () => {
        assert.strictEqual((await ask("what is 6-2?")).trim(), "4");
      });
      await it("7-4 = 3", async () => {
        assert.strictEqual((await ask("what is 7-4?")).trim(), "3");
      });
      await it("9-3 = 6", async () => {
        assert.strictEqual((await ask("what is 9-3?")).trim(), "6");
      });
      await it("8-5 = 3", async () => {
        assert.strictEqual((await ask("what is 8-5?")).trim(), "3");
      });

      await it("novel: 11-4=? - investigating generalisation (non-failing)", async () => {
        const result = (await ask("what is 11-4?")).trim();
        logger.log(
          `  ↳ 11-4=? → "${result}"  ${result === "7" ? "✓ generalised!" : "(expected 7 - still unknown)"}`
        );
      });
    });

    // -------------------------------------------------------------------------
    // MULTIPLICATION  (commutative)
    // Operand sums: 4, 5, 6, 7  (all unique)
    // "2*4=8" (sum 6) was omitted because it collides with "3*3=9" (sum 6).
    // -------------------------------------------------------------------------
    await describe("Multiplication  (×)", async () => {
      for (const f of ["2*2=4", "2*3=6", "3*3=9", "3*4=12"]) await teach(f);

      await it("2*2 = 4", async () => {
        assert.strictEqual((await ask("what is 2*2?")).trim(), "4");
      });
      await it("3*3 = 9", async () => {
        assert.strictEqual((await ask("what is 3*3?")).trim(), "9");
      });
      await it("2*3 = 6 (canonical)", async () => {
        assert.strictEqual((await ask("what is 2*3?")).trim(), "6");
      });
      await it("3*2 = 6 (commutative - same centroid, not explicitly taught)", async () => {
        assert.strictEqual((await ask("what is 3*2?")).trim(), "6");
      });
      await it("3*4 = 12", async () => {
        assert.strictEqual((await ask("what is 3*4?")).trim(), "12");
      });
      await it("4*3 = 12 (commutative - same centroid, not explicitly taught)", async () => {
        assert.strictEqual((await ask("what is 4*3?")).trim(), "12");
      });

      await it("novel: 4*4=? - investigating generalisation (non-failing)", async () => {
        const result = (await ask("what is 4*4?")).trim();
        logger.log(
          `  ↳ 4*4=? → "${result}"  ${result === "16" ? "✓ generalised!" : "(expected 16 - still unknown)"}`
        );
      });
    });

    // -------------------------------------------------------------------------
    // DIVISION  (non-commutative)
    // Operand sums: 6, 8, 9, 10, 12  (all unique - no dedup collisions)
    // -------------------------------------------------------------------------
    await describe("Division  (÷)", async () => {
      for (const f of ["4/2=2", "6/2=3", "6/3=2", "8/2=4", "9/3=3"])
        await teach(f);

      await it("4/2 = 2", async () => {
        assert.strictEqual((await ask("what is 4/2?")).trim(), "2");
      });
      await it("6/2 = 3", async () => {
        assert.strictEqual((await ask("what is 6/2?")).trim(), "3");
      });
      await it("6/3 = 2", async () => {
        assert.strictEqual((await ask("what is 6/3?")).trim(), "2");
      });
      await it("8/2 = 4", async () => {
        assert.strictEqual((await ask("what is 8/2?")).trim(), "4");
      });
      await it("9/3 = 3", async () => {
        assert.strictEqual((await ask("what is 9/3?")).trim(), "3");
      });

      await it("novel: 12/4=? - investigating generalisation (non-failing)", async () => {
        const result = (await ask("what is 12/4?")).trim();
        logger.log(
          `  ↳ 12/4=? → "${result}"  ${result === "3" ? "✓ generalised!" : "(expected 3 - still unknown)"}`
        );
      });
    });

    await rt.dispose();
  });
}
