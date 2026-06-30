import assert from "node:assert/strict";
import Runtime from "@core_i/Runtime";
import { IntentTag } from "@utils/intentPrecept";
import { describe, it } from "./utils/harness";

/**
 * ORGANIC reasoning-vs-rationalization: the direction is produced by which
 * MECHANISM ran, not by a scripted per-case firing order (the limitation of the
 * corpus guard). Two real mechanisms drive the same manifold:
 *
 *   - forward learner   (Traveler.assessForwardSupport): the premises are
 *     PRESENTED, so they fire and feed a conclusion forward ⇒ reasoning.
 *   - intent justifier  (Traveler.justifyIntent): an intent fires, then reaches
 *     BACK to older established memory to justify itself ⇒ rationalization.
 *
 * Neither test below sets posW/firing by hand - the mechanisms do, keyed to what
 * they structurally are. The dual-age geometry then recovers the direction.
 */
export async function runDirectionalOrganicTests() {
  await describe("DIRECTIONAL ORGANIC (mechanism-driven direction)", async () => {
    const rt = await Runtime.boot({
      atomizer: "semantic",
      db: ":memory:",
      noTick: true,
      noLifecycle: true,
      skipIdentity: true,
      noWorkers: true,
    });
    await rt.ready;
    const sys = rt.system;
    const atomizer = rt.atomizer;
    const traveler = rt.mapper;

    // KB: establish premise then conclusion (timed), so both are older-born
    // resident concepts by the time either mechanism measures them.
    const PAIRS = [
      { premise: "rain", conclusion: "flood" },
      { premise: "fire", conclusion: "smoke" },
      { premise: "study", conclusion: "knowledge" },
    ];
    const established: {
      premise: string;
      conclusion: string;
      conclusionId: number;
    }[] = [];
    for (const p of PAIRS) {
      atomizer.ingestSequence(p.premise, sys);
      sys.decay(4000);
      const conclusionId = atomizer.ingestSequence(p.conclusion, sys)[0];
      sys.decay(4000);
      established.push({ ...p, conclusionId });
    }
    sys.decay(4000);

    await describe("forward mechanism reads as reasoning", async () => {
      for (const e of established) {
        await it(`present "${e.premise}" → "${e.conclusion}"`, async () => {
          const probe = atomizer.ingestSequence(e.premise, sys);
          const dir = traveler.assessForwardSupport(e.conclusionId, probe);
          assert.ok(dir, "expected a direction signature");
          assert.equal(
            dir.derivedMode,
            "reasoning",
            "presented premises fire ⇒ forward"
          );
          assert.ok(!dir.isRationalization, "must not flag reasoning");
        });
      }
    });

    await describe("intent mechanism reads as rationalization", async () => {
      for (const e of established) {
        await it(`intent("${e.conclusion}") reaches back to memory`, async () => {
          const intentId = traveler.spawnIntent(
            e.conclusion,
            2.0,
            IntentTag.USER_UNKNOWN
          );
          assert.ok(
            intentId !== null && intentId >= 0,
            "intent precept spawned"
          );
          const dir = await traveler.justifyIntent(intentId);
          assert.ok(dir, "expected a justification signature");
          assert.equal(
            dir.derivedMode,
            "rationalization",
            "a freshly fired intent leaning on older memory ⇒ backward"
          );
        });
      }
    });

    await describe("the two mechanisms separate without scripted firing", async () => {
      await it("forward ⇒ reasoning, intent ⇒ rationalization on the same concept", async () => {
        const e = established[0];
        const probe = atomizer.ingestSequence(e.premise, sys);
        const fwd = traveler.assessForwardSupport(e.conclusionId, probe);

        const intentId = traveler.spawnIntent(
          e.conclusion,
          2.0,
          IntentTag.USER_UNKNOWN
        );
        const bwd = await traveler.justifyIntent(intentId as number);

        assert.equal(fwd?.derivedMode, "reasoning");
        assert.equal(bwd?.derivedMode, "rationalization");
        assert.notEqual(fwd?.derivedMode, bwd?.derivedMode);
      });
    });
  });
}
