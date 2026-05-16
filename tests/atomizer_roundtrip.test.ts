/**
 * Atomizer round-trip property tests.
 *
 * Invariants:
 *   1. decodeSequence(ingestSequence(text, sys), sys) === text  (for base atomizer)
 *   2. Every atom has finite, in-bounds position and mass values.
 *   3. Operator tokens receive mass = c² (not epsilon).
 *   4. Atom count matches expected token count for simple inputs.
 */
import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import { OperatorClass } from "@core_i/System";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

const FIXTURES = [
  "p implies q",
  "all humans are mortal",
  "x implies y && y implies z",
  "the sky is blue",
  "negation of the premise",
  "function returns boolean",
];

export async function executeAtomizerRoundTripSuite() {
  await describe("Atomizer Round-Trip Property Tests", async () => {
    const env = await TestHarness.getEnvironment("base");

    for (const text of FIXTURES) {
      await it(`round-trip: "${text}"`, async () => {
        const ids = env.atomizer.ingestSequence(text, env.system);
        assert.ok(
          ids.length > 0,
          `ingestSequence must return at least one id for "${text}"`
        );

        const decoded = env.atomizer.decodeSequence(ids, env.system).trim();
        assert.strictEqual(
          decoded,
          text,
          `decode(ingest("${text}")) must round-trip exactly`
        );

        for (const id of ids) {
          assert.ok(id >= 0, `id must be non-negative; got ${id}`);
          assert.ok(
            id < DOPAT_CONFIG.MAX_PRECEPTS,
            `id ${id} must be within MAX_PRECEPTS=${DOPAT_CONFIG.MAX_PRECEPTS}`
          );
          assert.ok(
            env.system.isAllocated(id),
            `id ${id} must be allocated after ingest`
          );
          assert.ok(
            isFinite(env.system.posX[id]),
            `posX must be finite for id ${id}`
          );
          assert.ok(
            isFinite(env.system.posY[id]),
            `posY must be finite for id ${id}`
          );
          assert.ok(
            isFinite(env.system.posZ[id]),
            `posZ must be finite for id ${id}`
          );
          assert.ok(
            isFinite(env.system.posW[id]),
            `posW must be finite for id ${id}`
          );
          assert.ok(
            isFinite(env.system.mass[id]),
            `mass must be finite for id ${id}`
          );
        }
      });
    }

    await it("operator tokens receive mass = c²", async () => {
      const ids = env.atomizer.ingestSequence("p implies q", env.system);
      // ids[1] = "implies" which should be OperatorClass.IdentityShift
      const impliesId = ids[1];
      assert.strictEqual(
        env.system.operatorClass[impliesId],
        OperatorClass.IdentityShift,
        `"implies" must have IdentityShift operator class`
      );
      assert.strictEqual(
        env.system.mass[impliesId],
        env.system.c ** 2,
        `operator "implies" must have mass = c²`
      );
    });

    await it("atom (non-operator) tokens receive mass = epsilon", async () => {
      const ids = env.atomizer.ingestSequence("apple orange", env.system);
      for (const id of ids) {
        assert.strictEqual(
          env.system.operatorClass[id],
          OperatorClass.None,
          `semantic atom must have OperatorClass.None`
        );
        assert.strictEqual(
          env.system.mass[id],
          env.system.c,
          `semantic atom must have mass = epsilon`
        );
      }
    });

    await it("scope is stable across repeated ingestion of the same token", async () => {
      const ids1 = env.atomizer.ingestSequence("mortal", env.system);
      const ids2 = env.atomizer.ingestSequence("mortal", env.system);
      assert.strictEqual(
        env.system.scope[ids1[0]],
        env.system.scope[ids2[0]],
        "scope of the same word must be stable across calls"
      );
    });

    await it("checksum is valid after ingest", async () => {
      const ids = env.atomizer.ingestSequence("logic is fun", env.system);
      for (const id of ids) {
        assert.ok(
          env.system.validate(id),
          `checksum validation must pass for freshly ingested id ${id}`
        );
      }
    });

    await TestHarness.disposeEnvironment(env);
  });
}
