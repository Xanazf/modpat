import assert from "node:assert/strict";
import { evaluateCorpus } from "../scripts/dev/directional_corpus_validation";
import { describe, it } from "./utils/harness";

/**
 * End-to-end guard for the reasoning-vs-rationalization payoff. Runs a labeled
 * corpus through the REAL ingest pipeline (semantic atomizer + manifold clock);
 * the only scripted input is firing order, which is the ground-truth label. See
 * scripts/dev/directional_corpus_validation.ts for the narrative.
 *
 * Pins three claims:
 *   1. With referent remap, the derived direction recovers the label.
 *   2. Without the remap (classifying throwaway probe atoms), the signal
 *      collapses - so the remap is load-bearing, not cosmetic.
 *   3. Backward-reached support is systematically lower amplitude than forward
 *      (THEORY.md's falsifiable claim), measured on identical support sets.
 */
export async function runDirectionalCorpusTests() {
  await describe("DIRECTIONAL CORPUS (end-to-end payoff)", async () => {
    const result = await evaluateCorpus();

    await it("recovers the label with referent remap", async () => {
      assert.equal(
        result.accRemap,
        1,
        `balanced accuracy with remap must be 100% (got ${(result.accRemap * 100).toFixed(1)}%)`
      );
    });

    await it("collapses without the remap (remap is load-bearing)", async () => {
      assert.ok(
        result.accRaw < result.accRemap,
        `control (no remap, ${(result.accRaw * 100).toFixed(1)}%) must underperform the remap path (${(result.accRemap * 100).toFixed(1)}%)`
      );
    });

    await it("backward support is systematically lower amplitude (falsifiable claim)", async () => {
      assert.ok(
        result.meanFwd > result.meanBwd,
        `mean forward (${result.meanFwd.toFixed(3)}) must exceed mean backward (${result.meanBwd.toFixed(3)})`
      );
      // Per item, backward must never EXCEED forward (penalty ≤ 1 always).
      for (const r of result.rows) {
        assert.ok(
          r.bwd <= r.fwd + 1e-9,
          `backward (${r.bwd.toFixed(3)}) exceeded forward (${r.fwd.toFixed(3)}) for a ${r.label} item`
        );
      }
    });

    await it("holds across VARIED geometry (not a uniform-spread artifact)", async () => {
      // The corpus mixes tiny vs huge born-distances and 1-3 premises; the
      // rationalization ratios must therefore span a real range, not cluster at
      // one value (the weakness the original flat corpus had).
      const ratios = result.rows
        .filter(r => r.label === "rationalization")
        .map(r => r.ratio);
      const spread = Math.max(...ratios) - Math.min(...ratios);
      assert.ok(
        spread > 0.05,
        `rationalization ratio spread (${spread.toFixed(3)}) must reflect varied geometry`
      );
      // And support size genuinely varies.
      const sizes = new Set(result.rows.map(r => r.nPrem));
      assert.ok(sizes.size >= 2, "corpus must vary the number of premises");
    });
  });
}
