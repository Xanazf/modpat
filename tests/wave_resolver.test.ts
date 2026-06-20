import assert from "node:assert/strict";
import Atomizer from "@atomics/LogicAtomizer";
import {
  type PoleResolver,
  resolveWave,
  type WaveBand,
} from "@core_i/formula/WaveResolver";
import { OperatorClass } from "@core_i/helpers/enums";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
import { describe, it } from "./utils/harness";

/**
 * Guard tests for the WaveResolver (logic-as-wave-collision on geometry).
 *
 * These build manifold state DIRECTLY with controlled positions/masses/scopes -
 * negation is encoded as antipodal position, exactly the geometry that step A
 * (stance positioning in language ingestion) will later produce automatically.
 * They lock the four cases validated in scripts/dev/vector_superposition_probe.ts:
 *   A ∧ ¬A    → contradiction (band cancels to 0)
 *   A ∧ B     → determinate (no false unknown)
 *   ¬¬A       → affirmed (antipode of antipode survives)
 *   (A⇒B)∧¬B  → antecedent band resolves to ¬ (modus tollens via bridge)
 */

const SCOPE_A = 100;
const SCOPE_B = 200;
// Poles are spatial (X,Y,Z) only - W is number-line/age, excluded from phase.
const P: [number, number, number] = [1, 1, 1]; // A's grounded pole
const Q: [number, number, number] = [1, -1, 0.5]; // B's grounded pole

const poleOf: PoleResolver = scope =>
  scope === SCOPE_A ? P : scope === SCOPE_B ? Q : null;

function bandFor(bands: WaveBand[], scope: number): WaveBand {
  const b = bands.find(x => x.scope === scope);
  assert.ok(b, `expected a band for scope ${scope}`);
  return b;
}

export async function runWaveResolverTests() {
  await describe("WaveResolver – logic as wave collision on geometry", async () => {
    // Each case gets a fresh System so ids/scopes don't bleed across tests.
    const fresh = () => new System();

    // place a content atom (variable: mass ≈ c) at an explicit spatial position;
    // `w` is the number-line/age axis, deliberately independent of the phasor.
    const placeContent = (
      sys: System,
      scope: number,
      pos: [number, number, number],
      w = 1
    ): number => {
      const id = sys.createLocation(sys.c, scope);
      sys.posX[id] = pos[0];
      sys.posY[id] = pos[1];
      sys.posZ[id] = pos[2];
      sys.posW[id] = w;
      return id;
    };

    // place an operator atom (massive ≈ c²) with a given class
    const placeOp = (sys: System, opClass: OperatorClass): number => {
      const id = sys.createLocation(sys.c * sys.c, 0);
      sys.operatorClass[id] = opClass;
      return id;
    };

    const neg = (v: [number, number, number]): [number, number, number] => [
      -v[0],
      -v[1],
      -v[2],
    ];

    await it("A ∧ ¬A → contradiction (band cancels in X/Y/Z; W divergence ignored)", async () => {
      const sys = fresh();
      // A and ¬A get DIFFERENT W (5 vs 99) to prove the phasor excludes W: the
      // band must still cancel on the spatial antipode alone.
      const a = placeContent(sys, SCOPE_A, P, 5);
      const and = placeOp(sys, OperatorClass.Conjunction);
      const notA = placeContent(sys, SCOPE_A, neg(P), 99); // antipodal = negation
      const sink = placeOp(sys, OperatorClass.Sink);
      const res = resolveWave(
        new Uint32Array([a, and, notA, sink]),
        sys,
        poleOf
      );
      assert.ok(res, "resolver should return a resolution");
      assert.equal(res.contradiction, true, "A ∧ ¬A must be a contradiction");
      assert.equal(res.contradictionScope, SCOPE_A);
      assert.ok(
        bandFor(res.bands, SCOPE_A).coherence < 1e-6,
        "band A must collapse to ~0"
      );
    });

    await it("A ∧ B → determinate (distinct bands, no false unknown)", async () => {
      const sys = fresh();
      const a = placeContent(sys, SCOPE_A, P);
      const and = placeOp(sys, OperatorClass.Conjunction);
      const b = placeContent(sys, SCOPE_B, Q);
      const res = resolveWave(new Uint32Array([a, and, b]), sys, poleOf);
      assert.ok(res);
      assert.equal(
        res.contradiction,
        false,
        "A ∧ B must NOT be a contradiction"
      );
      assert.ok(bandFor(res.bands, SCOPE_A).coherence > 0.5);
      assert.ok(bandFor(res.bands, SCOPE_B).coherence > 0.5);
      assert.equal(bandFor(res.bands, SCOPE_A).negated, false);
      assert.equal(bandFor(res.bands, SCOPE_B).negated, false);
    });

    await it("¬¬A → affirmed (antipode of antipode survives)", async () => {
      const sys = fresh();
      // double negation = antipode of antipode = the original pole position
      const aa = placeContent(sys, SCOPE_A, neg(neg(P)));
      const res = resolveWave(new Uint32Array([aa]), sys, poleOf);
      assert.ok(res);
      assert.equal(res.contradiction, false);
      const band = bandFor(res.bands, SCOPE_A);
      assert.equal(band.negated, false, "¬¬A must read as affirmed A");
      assert.ok(band.coherence > 0.5);
    });

    await it("(A⇒B) ∧ ¬B → antecedent band resolves to ¬ (modus tollens)", async () => {
      const sys = fresh();
      const a = placeContent(sys, SCOPE_A, P);
      const implies = placeOp(sys, OperatorClass.IdentityShift);
      const notB = placeContent(sys, SCOPE_B, neg(Q)); // ¬B antipodal to B's pole
      const res = resolveWave(new Uint32Array([a, implies, notB]), sys, poleOf);
      assert.ok(res);
      assert.equal(res.contradiction, false);
      assert.equal(
        bandFor(res.bands, SCOPE_A).negated,
        true,
        "the bridge must rotate band A by π → ¬A"
      );
      assert.equal(
        bandFor(res.bands, SCOPE_B).negated,
        true,
        "¬B stays negated"
      );
    });
  });

  // -- Step A: stance positioning emerges from real language ingestion --------
  await describe("WaveResolver – stance geometry from language ingestion", async () => {
    await it('"fire and not fire" → antipodal placement (X/Y/Z reflected, W preserved) → contradiction', async () => {
      const sys = new System();
      const atomizer = new Atomizer();
      await atomizer.init();

      const ids = atomizer.ingestSequence("fire and not fire", sys);
      // tokens: [fire, and, not, fire] → the two content atoms share one scope
      const fireScope = atomizer.getSymbolScope("fire");
      const content = Array.from(ids).filter(id => sys.scope[id] === fireScope);
      assert.equal(content.length, 2, "both 'fire' mentions share a scope");
      const [aff, neg] = content;

      // X/Y/Z are exact antipodes: the negated mention reflected off the affirmed
      // concept pole.
      for (const axis of ["posX", "posY", "posZ"] as const) {
        assert.ok(
          Math.abs(sys[axis][aff] + sys[axis][neg]) < 1e-9,
          `${axis} must be antipodal: ${sys[axis][aff]} vs ${sys[axis][neg]}`
        );
      }
      // W is preserved, NOT reflected (number-line / age axis).
      assert.equal(
        sys.posW[neg],
        sys.posW[aff],
        "posW must be preserved (not reflected) for the negated mention"
      );

      // And the resolver reads the cancellation as a contradiction.
      const res = resolveWave(ids, sys);
      assert.ok(res);
      assert.equal(
        res.contradiction,
        true,
        "fire ∧ ¬fire must collapse to a contradiction"
      );
      assert.equal(res.contradictionScope, fireScope);
    });
  });

  // -- Step C: the wave channel is wired into the live perceive pipeline -------
  await describe("WaveResolver – wired into perception (interference channel)", async () => {
    const system = new System();
    const atomizer = new Atomizer();
    await atomizer.init();
    const store = new Store(system, atomizer, ":memory:");
    await store.waitForInit();

    const freshTraveler = () => {
      system.reset();
      const t = createTestTraveler(
        system,
        atomizer,
        new Traveler(system, atomizer, store),
        store
      );
      t.setGPUEnabled(false);
      return t;
    };

    await it('"fire and not fire |-" derives unknown via provenance "interference"', async () => {
      const t = freshTraveler();
      const ids = atomizer.ingestSequence("fire and not fire |-", system);
      const out = await t.perceive(ids);
      const ans = atomizer.decodeSequence(out, system).trim();
      assert.equal(ans, "unknown", "contradiction must derive unknown");
      assert.equal(
        t.lastProvenance,
        "interference",
        "the verdict must come from the wave channel, not a cluster/settling fallback"
      );
    });

    await it("a non-contradiction does NOT trigger the interference channel", async () => {
      const t = freshTraveler();
      const ids = atomizer.ingestSequence("fire and water |-", system);
      const out = await t.perceive(ids);
      void out;
      assert.notEqual(
        t.lastProvenance,
        "interference",
        "fire ∧ water is not a contradiction"
      );
    });
  });
}
