import assert from "node:assert/strict";
import Atomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import {
  compose,
  composeScope,
  decompose,
  decomposeScope,
  isComposed,
  resolveCompositionQuery,
} from "@core_i/formula/Composition";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
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

  // -- Step 12: compose/decompose wired into a query path --------------------
  await describe("Composition – query path (step 12)", async () => {
    await it("resolveCompositionQuery: synthesis then decompose round-trip", async () => {
      const atomizer = new Atomizer();
      await atomizer.init();
      const sys = new System();

      // SYNTHESIS: "fire and water make steam" mints a product and names it.
      const synth = atomizer.ingestSequence("fire and water make steam", sys);
      const product = resolveCompositionQuery(synth, sys, atomizer);
      assert.ok(product && product.length === 1, "synthesis returns a product");
      assert.ok(
        isComposed(sys.scope[product[0]]),
        "the product carries a compound scope"
      );
      // the name "steam" is now bound to the compound scope (steam IS fire⊕water)
      assert.equal(atomizer.getSymbolScope("steam"), sys.scope[product[0]]);

      // DECOMPOSE: "what is steam made of" recovers the two parents by name.
      const q = atomizer.ingestSequence("what is steam made of", sys);
      const ans = resolveCompositionQuery(q, sys, atomizer);
      assert.ok(ans, "decompose returns an answer");
      const decoded = atomizer.decodeSequence(ans, sys).trim();
      assert.ok(
        decoded.includes("fire") && decoded.includes("water"),
        `decompose must name both parents, got "${decoded}"`
      );
    });

    await it("a non-composition query returns null (no false fire)", async () => {
      const atomizer = new Atomizer();
      await atomizer.init();
      const sys = new System();
      const q = atomizer.ingestSequence("the sky is blue |-", sys);
      assert.equal(resolveCompositionQuery(q, sys, atomizer), null);
    });

    await it('"what is X made of" for a primitive X yields nothing to decompose', async () => {
      const atomizer = new Atomizer();
      await atomizer.init();
      const sys = new System();
      const q = atomizer.ingestSequence("what is fire made of", sys);
      assert.equal(
        resolveCompositionQuery(q, sys, atomizer),
        null,
        "a non-composed concept has no parents to emit"
      );
    });

    await it("wired into perceive: provenance is 'composition'", async () => {
      const system = new System();
      const atomizer = new Atomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      const t = createTestTraveler(
        system,
        atomizer,
        new Traveler(system, atomizer, store),
        store
      );
      t.setGPUEnabled(false);

      const synth = atomizer.ingestSequence(
        "fire and water make steam",
        system
      );
      await t.perceive(synth);
      assert.equal(
        t.lastProvenance,
        "composition",
        "synthesis must resolve via the composition channel"
      );

      const q = atomizer.ingestSequence("what is steam made of", system);
      const out = await t.perceive(q);
      const decoded = atomizer.decodeSequence(out, system).trim();
      assert.equal(t.lastProvenance, "composition");
      assert.ok(
        decoded.includes("fire") && decoded.includes("water"),
        `decompose answer names both parents, got "${decoded}"`
      );
    });
  });
}
