/**
 * Skill-election suite (pre-P7 intermediate step #6).
 *
 * `Traveler.electSkill` used to route by string-matching the parsed intent
 * label onto a fixed capability ("code" → SKILL:CODE, else → SKILL:LANGUAGE).
 * It now elects by **potential-field proximity**: the capability precept whose
 * Gaussian attractor pulls hardest at the query's manifold locus wins, with the
 * intent classifier contributing an additive prior (`SKILL_INTENT_PRIOR`).
 *
 * The two guarantees this suite pins:
 *   1. Geometry-silent limit == legacy routing. A query that lands outside
 *      every capability basin scores ≈0 everywhere, so the intent prior alone
 *      decides - reproducing the old string routing exactly.
 *   2. Geometry can override the prior. A query that settles squarely inside a
 *      different capability's well elects that capability even when intent names
 *      another - the documented attractor-proximity behaviour.
 */

import { OperatorClass } from "@core_i/helpers/enums";
import Runtime from "@core_i/Runtime";
import * as assert from "assert";
import { describe, it } from "./utils/harness";

export async function runSkillElectionTests() {
  await describe("SKILL ELECTION (potential-field) SUITE", async () => {
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
    const atom = rt.atomizer;
    const mapper = rt.mapper;

    const LANG = atom.getSymbolScope("SKILL:LANGUAGE", false);
    const ASSERT = atom.getSymbolScope("SKILL:ASSERTION", false);
    const CODE = atom.getSymbolScope("SKILL:CODE", false);
    const ARITH = atom.getSymbolScope("SKILL:ARITHMETIC", false);

    // Ingest a throwaway token and pin its coordinate so the query locus is the
    // point under test (a single atom ⇒ the centroid IS its position).
    const queryAt = (
      token: string,
      x: number,
      y: number,
      z: number,
      w: number
    ): Uint32Array => {
      const ids = atom.ingestSequence(token, sys);
      const id = ids[0];
      sys.posX[id] = x;
      sys.posY[id] = y;
      sys.posZ[id] = z;
      sys.posW[id] = w;
      return Uint32Array.of(id);
    };

    await describe("Geometry-silent limit reproduces legacy intent routing", async () => {
      // Far outside every capability's influence radius (caps sit at posX 5-60).
      const far = queryAt("zebra", 1e5, 0, 0, 0);

      await it("intent=code → SKILL:CODE", async () => {
        assert.strictEqual(mapper.electSkill(far, "code"), CODE);
      });
      await it("intent=assertion → SKILL:ASSERTION", async () => {
        assert.strictEqual(mapper.electSkill(far, "assertion"), ASSERT);
      });
      await it("intent=question → SKILL:LANGUAGE (default)", async () => {
        assert.strictEqual(mapper.electSkill(far, "question"), LANG);
      });
      await it("intent=undefined → SKILL:LANGUAGE (default)", async () => {
        assert.strictEqual(mapper.electSkill(far, undefined), LANG);
      });
    });

    // NOTE on the production field. Only genuine Capability precepts (those
    // seedCapabilities tags `OperatorClass.Capability` at distinct coordinates)
    // are read as attractor field sources. In a live Runtime today the four
    // SKILL:* precepts are NOT proper, separated capabilities - they are already
    // allocated (grounded as the literal "SKILL:*" tokens, opClass 0/1) before
    // the seed runs, so its `isAllocated` guard skips them and they cluster
    // within ~10 posX units. The election therefore finds no qualifying field
    // source and defers to the intent prior - i.e. the legacy string routing IS
    // the production behaviour (validated above). The election is still genuinely
    // geometric; the next block proves a separated, properly-tagged capability's
    // basin overrides the prior - the behaviour that activates once capabilities
    // are seeded as the distinguished attractors seedCapabilities intends.
    await describe("A strong basin hit overrides the intent prior", async () => {
      // Make ARITHMETIC the proper, separated Capability attractor the seed
      // intends, then restore the live state afterwards.
      const saved = {
        x: sys.posX[ARITH],
        op: sys.operatorClass[ARITH],
      };
      const separateArith = () => {
        sys.posX[ARITH] = 5000;
        sys.operatorClass[ARITH] = OperatorClass.Capability;
      };
      const restoreArith = () => {
        sys.posX[ARITH] = saved.x;
        sys.operatorClass[ARITH] = saved.op;
      };

      await it("a query inside a separated capability's well elects it despite intent=code", async () => {
        // Drop the query squarely on ARITHMETIC: its self-pull (mass·e^0) is a
        // deep, unambiguous well, so geometry overrides the intent=code prior.
        separateArith();
        try {
          const q = queryAt("wombat", 5000, 0, 0, 0);
          assert.strictEqual(mapper.electSkill(q, "code"), ARITH);
        } finally {
          restoreArith();
        }
      });

      await it("shallow well keeps intent: a near-but-not-in query defers to the prior", async () => {
        // Park the query ~17 units off ARITHMETIC (d²≈300 ⇒ depth e^{-7.5}≈0.0006
        // ≪ SKILL_FIELD_MIN_DEPTH): not squarely in a well, so intent (code) holds.
        separateArith();
        try {
          const q = queryAt("giraffe", 5000 + 17.3, 0, 0, 0);
          assert.strictEqual(mapper.electSkill(q, "code"), CODE);
        } finally {
          restoreArith();
        }
      });
    });

    await describe("Degenerate inputs fall back cleanly", async () => {
      await it("empty query ⇒ 0", async () => {
        assert.strictEqual(mapper.electSkill(Uint32Array.of(), "code"), 0);
      });
      await it("all-unallocated query ⇒ intent prior decides", async () => {
        // An id past the allocated frontier contributes no mass ⇒ wsum 0.
        const ghost = Uint32Array.of(sys.length + 5);
        assert.strictEqual(mapper.electSkill(ghost, "assertion"), ASSERT);
      });
    });
  });
}
