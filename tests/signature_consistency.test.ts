/**
 * Signature consistency property test (S6 / G7).
 *
 * Invariant: abstractSequence(ingestSequence(text)) and signatureForText(text)
 * must produce the same VAR_N signature string for the same fact text, so that
 * seeded facts (VocabSeedWorker path → signatureForText) and challenged facts
 * (Learner path → abstractSequence) share the same lookup key in wave_forms.
 */
import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

const SAMPLE_SENTENCES = [
  "fire is hot",
  "water is wet",
  "socrates is mortal",
  "all humans are mortal",
  "the sky is blue",
  "cats are animals",
  "mathematics is a science",
  "einstein was a physicist",
  "the sun rises in the east",
  "gravity attracts masses",
  "logic implies reasoning",
  "knowledge is power",
  "the earth orbits the sun",
  "light travels fast",
  "neurons fire signals",
  "the heart pumps blood",
  "plants require sunlight",
  "oxygen supports combustion",
  "democracy requires participation",
  "evolution produces diversity",
];

export async function runSignatureConsistencyTests() {
  await describe("Signature Consistency (S6 / G7)", async () => {
    const env = await TestHarness.getEnvironment("base");
    const { system, atomizer, store } = env;

    let divergences = 0;

    for (const text of SAMPLE_SENTENCES) {
      await it(`Signatures match for: "${text}"`, async () => {
        const ids = atomizer.ingestSequence(text, system);
        const { signature: sigA } = store.abstractSequence(ids);
        const sigB = store.signatureForText(text);

        if (sigA !== sigB) {
          divergences++;
          logger.warn(
            `[SIG-DIVERGENCE] "${text}"\n` +
              `  abstractSequence  → ${sigA}\n` +
              `  signatureForText  → ${sigB}`
          );
        }
        assert.strictEqual(
          sigA,
          sigB,
          `Signature mismatch for "${text}": abstractSequence="${sigA}" vs signatureForText="${sigB}"`
        );
      });
    }

    await it("No divergences across all sample sentences", async () => {
      assert.strictEqual(
        divergences,
        0,
        `${divergences} signature divergence(s) detected — see warnings above`
      );
    });

    await TestHarness.disposeEnvironment(env);
  });
}
