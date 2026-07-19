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

import * as assert from "node:assert";
import { OperatorClass } from "@core_i/helpers/enums";
import Runtime from "@core_i/Runtime";
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

    // Skills are keyed by their SKILL:* symbol scope; the field source is the
    // Capability precept seedCapabilities allocates UNDER that scope.
    const capabilityId = (scope: number): number => {
      for (const id of sys.getIdsByScope(scope)) {
        if (sys.operatorClass[id] === OperatorClass.Capability) return id;
      }
      return -1;
    };

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

    await describe("seedCapabilities places real capability precepts", async () => {
      await it("all four SKILL:* scopes own a separated, Capability-tagged well", async () => {
        const caps = [LANG, ASSERT, CODE, ARITH].map(capabilityId);
        for (const id of caps) assert.ok(id >= 0, "capability precept seeded");
        for (const id of caps) {
          assert.strictEqual(sys.operatorClass[id], OperatorClass.Capability);
          assert.strictEqual(sys.mass[id], sys.c ** 2 * 10);
        }
        // Seeded coordinates are pairwise separated (no co-located wells).
        const xs = caps.map(id => sys.posX[id]);
        for (let i = 0; i < xs.length; i++) {
          for (let j = i + 1; j < xs.length; j++) {
            assert.ok(
              Math.abs(xs[i] - xs[j]) >= 5,
              `wells ${i} and ${j} separated`
            );
          }
        }
      });
    });

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
    // are read as attractor field sources; the skills map is keyed by the
    // SKILL:* symbol scope and electSkill resolves each scope to its Capability
    // precept through getIdsByScope. Queries whose locus lands outside every
    // well (the common case - content grounds far from posX 5-60) fall to the
    // intent prior, i.e. the legacy string routing (validated above). The next
    // block proves the geometric override: a query settling squarely inside a
    // separated capability's basin elects it despite a contrary intent label.
    await describe("A strong basin hit overrides the intent prior", async () => {
      // Move the seeded ARITHMETIC well far out on its own, then restore.
      const ARITH_CAP = capabilityId(ARITH);
      assert.ok(ARITH_CAP >= 0, "seeded ARITHMETIC capability exists");
      const saved = { x: sys.posX[ARITH_CAP] };
      const separateArith = () => {
        sys.posX[ARITH_CAP] = 5000;
      };
      const restoreArith = () => {
        sys.posX[ARITH_CAP] = saved.x;
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
