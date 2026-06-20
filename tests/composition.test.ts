import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import {
  compose,
  composeScope,
  decompose,
  decomposeScope,
  isComposed,
} from "@core_i/formula/Composition";
import System from "@core_i/System";
import { describe, it } from "./utils/harness";

/**
 * Guard tests for concept composition (fire ⊕ water → steam).
 *
 * Locks the two recovery channels validated in
 * scripts/dev/{modulation_roundtrip,composition_descent}_probe.ts:
 *   1. FREQUENCY  - sidebands in the compound scope recover both parents exactly.
 *   2. POSITION   - steam lands in the influence-overlap of both parents, so
 *                   descent in the parents' field reaches both.
 */

const R2 = DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS;
const F = DOPAT_CONFIG.PHYSICS.INFLUENCE_FALLOFF;

export async function runCompositionTests() {
  await describe("Composition – pure scope sidebands", async () => {
    await it("decomposeScope inverts composeScope for many pairs", async () => {
      for (const [a, b] of [
        [1, 2],
        [7, 7],
        [3, 999],
        [12345, 67],
        [500000, 1],
      ] as [number, number][]) {
        const s = composeScope(a, b);
        assert.ok(
          isComposed(s),
          `compound scope must be flagged composed: ${s}`
        );
        assert.ok(
          Number.isSafeInteger(s),
          "compound scope stays a safe integer"
        );
        const dec = decomposeScope(s);
        assert.ok(dec);
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        assert.deepEqual(
          dec.parents,
          [lo, hi],
          `recover parents of (${a},${b})`
        );
        // sidebands are the modulation sum/diff and reconstruct the parents.
        assert.equal(dec.sidebands.sum, lo + hi);
        assert.equal(dec.sidebands.diff, hi - lo);
        assert.equal((dec.sidebands.sum + dec.sidebands.diff) / 2, hi);
        assert.equal((dec.sidebands.sum - dec.sidebands.diff) / 2, lo);
      }
    });

    await it("composition is symmetric (fire⊕water = water⊕fire)", async () => {
      assert.equal(composeScope(42, 7), composeScope(7, 42));
    });

    await it("primitive scopes are not mistaken for compositions", async () => {
      assert.equal(isComposed(5), false);
      assert.equal(decomposeScope(5), null);
    });
  });

  await describe("Composition – manifold compose/decompose", async () => {
    // a content atom at an explicit spatial position with a given mass
    const placeConcept = (
      sys: System,
      scope: number,
      pos: [number, number, number],
      mass: number
    ): number => {
      const id = sys.createLocation(mass, scope);
      sys.posX[id] = pos[0];
      sys.posY[id] = pos[1];
      sys.posZ[id] = pos[2];
      sys.posW[id] = 1;
      return id;
    };

    await it("steam recovers BOTH parents' scopes exactly (frequency channel)", async () => {
      const sys = new System();
      // distinct scopes so the recovery is unambiguous
      const fire = placeConcept(sys, 101, [10, 0, 0], sys.c);
      const water = placeConcept(sys, 202, [-10, 0, 0], sys.c);

      const steam = compose(fire, water, sys);
      assert.ok(steam > 0);
      assert.ok(isComposed(sys.scope[steam]), "steam carries a compound scope");

      const dec = decompose(steam, sys);
      assert.ok(dec);
      assert.deepEqual(
        dec.parents,
        [101, 202],
        "decompose recovers fire and water scopes"
      );
      // and resolves back to the live parent atoms
      assert.deepEqual(dec.parentIds[0], [fire]);
      assert.deepEqual(dec.parentIds[1], [water]);
    });

    await it("steam lands in the influence-overlap of both parents (position channel)", async () => {
      const sys = new System();
      const fire = placeConcept(sys, 101, [10, 0, 0], sys.c);
      const water = placeConcept(sys, 202, [-10, 0, 0], sys.c);
      const steam = compose(fire, water, sys);

      const d2 = (a: number, b: number) => {
        const dx = sys.posX[a] - sys.posX[b];
        const dy = sys.posY[a] - sys.posY[b];
        const dz = sys.posZ[a] - sys.posZ[b];
        return dx * dx + dy * dy + dz * dz;
      };
      assert.ok(d2(steam, fire) < R2, "steam within fire's influence");
      assert.ok(d2(steam, water) < R2, "steam within water's influence");

      // equal masses → steam at the midpoint (the bisector saddle)
      assert.ok(
        Math.abs(sys.posX[steam]) < 1e-9,
        "equal-mass steam is centred"
      );

      // descent in the PARENTS' field (steam excluded) reaches both parents when
      // nudged toward each - the geometric round-trip the probe verified.
      const settle = (x0: number): number => {
        let x = x0;
        let vx = 0;
        const dt = DOPAT_CONFIG.PHYSICS.SETTLE_TRAVERSE_DT;
        const damp = DOPAT_CONFIG.PHYSICS.SETTLE_TRAVERSE_DAMPING;
        for (let s = 0; s < 200000; s++) {
          let fx = 0;
          for (const w of [fire, water]) {
            const dx = x - sys.posX[w];
            const dd = dx * dx;
            if (dd >= R2) continue;
            fx -= ((Math.exp(-dd / F) * 2) / F) * dx; // −∇V toward the well
          }
          vx = (vx + fx * dt) * (1 - damp * dt);
          x += vx * dt;
          if (Math.abs(fx) < 1e-8 && Math.abs(vx) < 1e-8) break;
        }
        // nearest parent
        return Math.abs(x - sys.posX[fire]) < Math.abs(x - sys.posX[water])
          ? fire
          : water;
      };
      const eps = 0.3;
      const right = settle(sys.posX[steam] + eps);
      const left = settle(sys.posX[steam] - eps);
      assert.equal(right, fire, "nudge toward fire drains to fire");
      assert.equal(left, water, "nudge toward water drains to water");
    });

    await it("round-trip: re-composing the recovered parents reproduces the scope", async () => {
      const sys = new System();
      const fire = placeConcept(sys, 101, [10, 0, 0], sys.c);
      const water = placeConcept(sys, 202, [-10, 0, 0], sys.c);
      const steam = compose(fire, water, sys);

      const dec = decompose(steam, sys);
      assert.ok(dec);
      assert.equal(
        composeScope(dec.parents[0], dec.parents[1]),
        sys.scope[steam],
        "compose(decompose(steam)) === steam.scope"
      );
    });
  });
}
