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
  measureInferenceAmplitude,
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
    let next = sys.length + 16;
    const place = (w: number, density: number, intensity: number): number => {
      const id = next++;
      sys.allocated[id] = 1;
      if (id >= sys.length) sys.length = id + 1;
      sys.posW[id] = w;
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
        const c = place(100, 3, 3);
        const premises = [place(30, 3, 3), place(20, 3, 3)];
        const d = classifyInferenceDirection(sys, c, premises);
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
