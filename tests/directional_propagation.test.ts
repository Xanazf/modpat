/**
 * Directional W-propagation suite (pre-P7 intermediate step #7).
 *
 * Guards the energetic enforcement of reasoning-vs-rationalization
 * (NOTES.md "The W Dimension"): support gathered by reaching BACKWARD along W
 * (a conclusion justifying itself from older premises) is systematically lower
 * amplitude than the same support gathered FORWARD (older premises → newer
 * conclusion, with the time arrow). See `DirectionalPropagation.ts`.
 */

import * as assert from "node:assert";
import Runtime from "@core_i/Runtime";
import {
  classifyInferenceDirection,
  inferPropagationMode,
  measureInferenceAmplitude,
  resolveReferents,
} from "@core_i/skills/cognition/DirectionalPropagation";
import { describe, it } from "./utils/harness";

export async function runDirectionalPropagationTests() {
  await describe("DIRECTIONAL W-PROPAGATION SUITE", async () => {
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
    const mapper = rt.mapper;

    // Place scratch precepts past the live frontier with controlled W / charge.
    // `w` is written to wBirth (stable born-position: the distance term). `fresh`
    // is written to posW (firing recency: the origin/direction term). They are
    // deliberately separable so the two roles can be exercised independently.
    let next = sys.length + 16;
    const place = (
      w: number,
      density: number,
      intensity: number,
      fresh = 0
    ): number => {
      const id = next++;
      sys.allocated[id] = 1;
      if (id >= sys.length) sys.length = id + 1;
      sys.wBirth[id] = w;
      sys.posW[id] = fresh;
      sys.density[id] = density;
      sys.intensity[id] = intensity;
      sys.mass[id] = 1;
      return id;
    };

    await describe("Backward support is lower amplitude than forward", async () => {
      await it("same premises, lower amplitude when reached backward", async () => {
        const c = place(100, 3, 3);
        const premises = [place(90, 3, 3), place(40, 3, 3)];
        const fwd = measureInferenceAmplitude(sys, c, premises, "reasoning");
        const bwd = measureInferenceAmplitude(
          sys,
          c,
          premises,
          "rationalization"
        );
        assert.ok(
          bwd.amplitude < fwd.amplitude,
          `backward (${bwd.amplitude}) must be < forward (${fwd.amplitude})`
        );
      });

      await it("older premises attenuate more under backward propagation", async () => {
        const c = place(100, 3, 3);
        const recent = place(98, 3, 3);
        const ancient = place(10, 3, 3);
        const bwd = measureInferenceAmplitude(
          sys,
          c,
          [recent, ancient],
          "rationalization"
        );
        const recentAmp = bwd.contributions.find(x => x.id === recent)!;
        const ancientAmp = bwd.contributions.find(x => x.id === ancient)!;
        assert.ok(
          ancientAmp.amplitude < recentAmp.amplitude,
          "the ancient premise must contribute less than the recent one"
        );
      });

      await it("W-coincident premises have no direction (forward == backward)", async () => {
        const c = place(100, 3, 3);
        const coincident = [place(100, 4, 2), place(100, 1, 3)];
        const fwd = measureInferenceAmplitude(sys, c, coincident, "reasoning");
        const bwd = measureInferenceAmplitude(
          sys,
          c,
          coincident,
          "rationalization"
        );
        assert.ok(
          Math.abs(fwd.amplitude - bwd.amplitude) < 1e-9,
          "coincident premises must yield identical amplitude both directions"
        );
      });
    });

    await describe("Direction classification", async () => {
      await it("flags a backward-leaning inference as rationalization", async () => {
        // Conclusion fired last (freshest) AND its premises are older-born:
        // both signals agree it is reaching back to justify itself.
        const c = place(100, 3, 3, /* fresh */ 1);
        const premises = [place(30, 3, 3, 0), place(20, 3, 3, 0)];
        const d = classifyInferenceDirection(sys, c, premises);
        assert.equal(d.derivedMode, "rationalization");
        assert.ok(d.ratio < 1, "ratio must be < 1 for older premises");
        assert.ok(d.isRationalization, "should flag as rationalization");
      });

      await it("does not flag a W-coincident inference", async () => {
        const c = place(100, 3, 3);
        const premises = [place(100, 3, 3), place(100, 3, 3)];
        const d = classifyInferenceDirection(sys, c, premises);
        assert.ok(Math.abs(d.ratio - 1) < 1e-9, "coincident ratio must be 1");
        assert.ok(!d.isRationalization, "coincident must not be flagged");
      });

      await it("does NOT flag when the premises fired last (forward reproduction)", async () => {
        // Same older-born premises, but a premise is the freshest node: the wave
        // originates there and feeds the conclusion forward. The spread is real
        // (ratio < 1) but the derived origin says reasoning, so no flag.
        const c = place(100, 3, 3, /* fresh */ 0);
        const premises = [place(30, 3, 3, 1), place(20, 3, 3, 1)];
        const d = classifyInferenceDirection(sys, c, premises);
        assert.equal(d.derivedMode, "reasoning");
        assert.ok(d.ratio < 1, "spread still produces a sub-1 ratio");
        assert.ok(
          !d.isRationalization,
          "must not flag: the premises, not the conclusion, fired first"
        );
      });
    });

    await describe("Signed Δw", async () => {
      await it("newer-born premises incur no backward penalty (δ < 0)", async () => {
        // Premises born AFTER the conclusion: reaching them is not a descent into
        // older knowledge, so max(0, δ) = 0 and backward == forward.
        const c = place(50, 3, 3, 1);
        const premises = [place(80, 3, 3, 0), place(90, 3, 3, 0)];
        const fwd = measureInferenceAmplitude(sys, c, premises, "reasoning");
        const bwd = measureInferenceAmplitude(
          sys,
          c,
          premises,
          "rationalization"
        );
        assert.ok(
          Math.abs(fwd.amplitude - bwd.amplitude) < 1e-9,
          "no descending reach ⇒ no penalty ⇒ fwd == bwd"
        );
        const d = classifyInferenceDirection(sys, c, premises);
        assert.ok(
          !d.isRationalization,
          "leaning on newer-born support is not rationalization"
        );
      });

      await it("older-born premises are penalized proportionally to descent", async () => {
        const c = place(100, 3, 3, 1);
        const near = place(80, 3, 3, 0); // δ = 20
        const far = place(10, 3, 3, 0); // δ = 90
        const bwd = measureInferenceAmplitude(
          sys,
          c,
          [near, far],
          "rationalization"
        );
        const nearAmp = bwd.contributions.find(x => x.id === near)!;
        const farAmp = bwd.contributions.find(x => x.id === far)!;
        assert.ok(
          farAmp.amplitude < nearAmp.amplitude,
          "deeper descent into older knowledge attenuates more"
        );
      });
    });

    await describe("Direction is derived from the dual age geometry", async () => {
      await it("conclusion freshest ⇒ rationalization; a premise freshest ⇒ reasoning", async () => {
        const c = place(100, 3, 3, /* fresh */ 5);
        const premises = [place(30, 3, 3, 1), place(20, 3, 3, 1)];
        assert.equal(
          inferPropagationMode(sys, c, premises),
          "rationalization",
          "conclusion fired last"
        );

        // Re-fire a premise so IT is now the freshest node: origin flips, and so
        // must the derived mode - re-anchoring posW SHOULD move this (unlike the
        // wBirth-based amplitude, which must not).
        sys.posW[premises[0]] = 9;
        assert.equal(
          inferPropagationMode(sys, c, premises),
          "reasoning",
          "a premise now fired last"
        );
      });

      await it("amplitude (given a fixed mode) is independent of posW", async () => {
        const c = place(100, 3, 3, 1);
        const premises = [place(40, 3, 3, 0)];
        const base = measureInferenceAmplitude(
          sys,
          c,
          premises,
          "reasoning"
        ).amplitude;

        sys.posW[c] = 999;
        sys.posW[premises[0]] = -999;
        const after = measureInferenceAmplitude(
          sys,
          c,
          premises,
          "reasoning"
        ).amplitude;
        assert.equal(after, base, "the distance term reads wBirth only");
      });
    });

    await describe("Referent-age remap (probe atoms → established concepts)", async () => {
      await it("resolves a fresh probe atom to the oldest prior precept of its scope", async () => {
        const scope = 987654;
        const established = sys.createLocation(1, scope); // born at T0
        sys.decay(5000); // advance the clock
        const probe = sys.createLocation(1, scope); // born later (throwaway)

        assert.ok(
          sys.wBirth[established] < sys.wBirth[probe],
          "established concept is older-born than the fresh probe atom"
        );

        const referents = resolveReferents(sys, [probe]);
        assert.equal(
          referents[0],
          established,
          "probe atom must remap to the established referent"
        );
      });

      await it("a novel scope with no prior instance falls back to the probe atom", async () => {
        sys.decay(1000);
        const probe = sys.createLocation(1, 123987);
        const referents = resolveReferents(sys, [probe]);
        assert.equal(
          referents[0],
          probe,
          "no established referent ⇒ keep the fresh atom (wBirth = now is correct)"
        );
      });
    });

    await describe("Traveler hooks delegate to the propagation model", async () => {
      await it("inferenceAmplitude / inferenceDirection agree with the module", async () => {
        const c = place(100, 3, 3);
        const premises = [place(70, 3, 3), place(50, 3, 3)];
        const viaTraveler = mapper.inferenceAmplitude(
          c,
          premises,
          "rationalization"
        );
        const viaModule = measureInferenceAmplitude(
          sys,
          c,
          premises,
          "rationalization"
        );
        assert.strictEqual(viaTraveler.amplitude, viaModule.amplitude);
        const dir = mapper.inferenceDirection(c, premises);
        assert.ok(dir.backward < dir.forward);
      });

      await it("exposes lastInferenceDirection, populated by live crystallization", async () => {
        // Wiring guard: the live learner records the W-direction signature of
        // each crystallized conclusion here (Traveler._crystallizeLearnedPath),
        // so the reasoning-vs-rationalization measurement is an output property
        // of the pipeline, not a callable-only hook. Defaults null pre-cycle.
        assert.strictEqual(mapper.lastInferenceDirection, null);
      });
    });
  });
}
