/**
 * Coherence-gate regression guard.
 *
 * The "gate = 100% balanced accuracy" figure cited across ROADMAP.md lived only
 * in tests/benchmarks/coherence_calibration.ts, which `yarn test` never ran - so
 * a silent drop went unnoticed. This suite runs the same labelled corpus through
 * the live perceive pipeline and pins the gate's behaviour (now back to 100%
 * balanced accuracy after the antonymic-placement fix resolved disj2), so any
 * further drift fails CI instead of rotting in an unrun benchmark.
 *
 * What is asserted, strongest first:
 *   1. NO false-emit. A wrong answer escaping the gate is a safety violation
 *      ("never emit a wrong answer") and must always be empty.
 *   2. Balanced accuracy holds a floor.
 *   3. The set of over-abstained CORRECT answers equals the pinned known set.
 *      A new id ⇒ a fresh regression. An empty set ⇒ disj2 got fixed, in which
 *      case this assertion fails on purpose: tighten KNOWN_OVER_ABSTAINS and
 *      raise the floor to 1.0 rather than let the win drift away unrecorded.
 */

import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import {
  type CalibrationResult,
  runCalibration,
} from "./benchmarks/coherence_calibration";
import { describe, it } from "./utils/harness";

/**
 * Correct answers the gate suppresses. Now EMPTY: `disj2` ("either inside or
 * outside; not outside; the cat ⊢ inside") used to over-abstain because the
 * derived conclusion landed on a singular region (pathCoherence 0), but the
 * antonymic-placement work (commit "didn't account for the new antonymic
 * placements") resolved the singular placement and disj2 now emits its correct
 * answer. The gate is back to 100% balanced accuracy; a non-empty set here is a
 * fresh regression.
 */
const KNOWN_OVER_ABSTAINS: string[] = [];

/**
 * Floor for gate balanced accuracy. Back to 1.0 now that KNOWN_OVER_ABSTAINS is
 * empty (every correct answer emits; every abstain is genuinely wrong).
 */
const GATE_BALANCED_ACCURACY_FLOOR = 1.0;

const ids = (rows: CalibrationResult["rows"]): string[] =>
  rows.map(r => r.id).sort();

export async function runCoherenceCalibrationTests(): Promise<void> {
  await describe("COHERENCE CALIBRATION - GATE REGRESSION GUARD", async () => {
    const result = await runCalibration();

    await it("never emits a wrong answer (gate false-emit = 0)", async () => {
      logger.log(
        `  false-emits: ${ids(result.falseEmits).join(", ") || "(none)"}`
      );
      assert.deepEqual(
        ids(result.falseEmits),
        [],
        "a wrong answer escaped the gate - the 'never emit a wrong answer' invariant broke"
      );
    });

    await it(`gate balanced accuracy holds the floor (>= ${(GATE_BALANCED_ACCURACY_FLOOR * 100).toFixed(0)}%)`, async () => {
      logger.log(
        `  gate balanced accuracy = ${(result.gateBalancedAccuracy * 100).toFixed(1)}% ` +
          `(coherence-score-alone = ${(result.coherenceBalancedAccuracy * 100).toFixed(1)}%)`
      );
      assert.ok(
        result.gateBalancedAccuracy >= GATE_BALANCED_ACCURACY_FLOOR,
        `gate balanced accuracy ${(result.gateBalancedAccuracy * 100).toFixed(1)}% fell below the ${(GATE_BALANCED_ACCURACY_FLOOR * 100).toFixed(0)}% floor`
      );
    });

    await it("over-abstentions match the pinned known set", async () => {
      logger.log(
        `  over-abstains: ${ids(result.overAbstains).join(", ") || "(none)"}`
      );
      assert.deepEqual(
        ids(result.overAbstains),
        [...KNOWN_OVER_ABSTAINS].sort(),
        "the set of over-abstained correct answers changed: KNOWN_OVER_ABSTAINS is empty, so any id here is a fresh regression (a correct answer the gate started suppressing)"
      );
    });
  });
}
