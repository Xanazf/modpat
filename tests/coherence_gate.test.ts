/**
 * Phase 2 - coherence score separation.
 *
 * Before the score can gate emission it must demonstrably separate coherent
 * traversals (clean geodesic through faithful terrain) from incoherent ones
 * (threading a collapsed / over-packed region, or winding heavily). This builds
 * both kinds of terrain in a real System and checks the score tells them apart -
 * the same "prove the mechanism in isolation first" discipline as Phase 1.
 */

import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import assert from "node:assert";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
import { gateEmit, pathCoherence } from "@skill_cogi/Coherence";
import logger from "@utils/SpectralLogger";
import { describe, it } from "./utils/harness";

function addAtom(
  system: System,
  x: number,
  y: number,
  z: number,
  w: number,
  scope: number
): number {
  const id = system.createLocation(system.c, scope);
  system.posX[id] = x;
  system.posY[id] = y;
  system.posZ[id] = z;
  system.posW[id] = w;
  system.update(id);
  return id;
}

export async function runCoherenceGateTests(): Promise<void> {
  await describe("PHASE 2 - COHERENCE SCORE SEPARATION", async () => {
    const system = new System();
    let scope = 1;

    // Clean terrain: a few well-spaced atoms forming a gentle path.
    const cleanIds = new Uint32Array([
      addAtom(system, 10, 0, 0, 0, scope++),
      addAtom(system, 20, 0, 0, 0, scope++),
      addAtom(system, 30, 0, 0, 0, scope++),
    ]);

    // Collapsed terrain: many atoms piled on the same coordinates (a singularity
    // - concepts colliding, rank-deficient local geometry).
    const pileIds: number[] = [];
    for (let i = 0; i < 20; i++) {
      pileIds.push(addAtom(system, 50, 50, 0, 0, scope++));
    }

    const grid = new GridIndex4D();
    grid.buildFromSystem(system);

    await it("scores a clean path coherent and a collapsed path incoherent", async () => {
      const clean = pathCoherence(cleanIds, system, grid, 0.1);
      const pile = pathCoherence(
        new Uint32Array(pileIds.slice(0, 3)),
        system,
        grid,
        0.1
      );

      logger.log(
        `  clean: score=${clean.score.toFixed(3)} ` +
          `coherent=${clean.coherent} maxSing=${clean.maxSingularity.toFixed(3)}`
      );
      logger.log(
        `  pile:  score=${pile.score.toFixed(4)} ` +
          `coherent=${pile.coherent} maxSing=${pile.maxSingularity.toFixed(1)}`
      );

      assert.ok(clean.coherent, "clean path should be judged coherent");
      assert.ok(!pile.coherent, "collapsed path should be judged incoherent");
      assert.ok(
        clean.score > 0.5,
        `clean score ${clean.score.toFixed(3)} should exceed 0.5`
      );
      assert.ok(
        pile.score < 0.1,
        `pile score ${pile.score.toFixed(4)} should fall below 0.1`
      );
      assert.ok(
        pile.maxSingularity > clean.maxSingularity,
        "the pile must register a higher singularity than clean terrain"
      );
    });

    await it("winding (inferential effort) alone can gate a clean path", async () => {
      const lowEffort = pathCoherence(cleanIds, system, grid, 0.1);
      const highEffort = pathCoherence(cleanIds, system, grid, 2.0);

      logger.log(
        `  effort 0.1 -> ${lowEffort.score.toFixed(3)}, ` +
          `effort 2.0 -> ${highEffort.score.toFixed(3)}`
      );

      assert.ok(
        highEffort.score < lowEffort.score,
        "higher inferential effort must lower the coherence score"
      );
      assert.ok(
        !highEffort.coherent,
        "a heavily-wound path should be gated even over clean terrain"
      );
    });

    await it("provenance: a rule-free short echo is gated; a rule-derived one is trusted", async () => {
      // Output = a strict subset of the input scopes (a 1-token restatement).
      const inputIds = cleanIds;
      const outputIds = new Uint32Array([cleanIds[1]]);

      const ruled = gateEmit(inputIds, outputIds, system, grid, 0.1, {
        ruleDerived: true,
      });
      const clustered = gateEmit(inputIds, outputIds, system, grid, 0.1, {
        ruleDerived: false,
      });

      logger.log(`  ruleDerived=true  -> emit=${ruled.emit} (${ruled.reason})`);
      logger.log(
        `  ruleDerived=false -> emit=${clustered.emit} (${clustered.reason})`
      );

      assert.ok(
        ruled.emit,
        "a rule-derived short conclusion built from input scopes must emit"
      );
      assert.ok(
        !clustered.emit && clustered.reason === "echo",
        "the same tokens from the rule-free cluster fallback are an echo"
      );
    });
  });

  await describe("PHASE 2 - GRADED ABSTENTION (definitive → hedged → silent)", async () => {
    const system = new System();
    const atomizer = new LogicAtomizer();
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

    await it("a derived conclusion is definitive", async () => {
      const t = freshTraveler();
      const ids = atomizer.ingestSequence(
        "all birds are animals. tweety is a bird. tweety |-",
        system
      );
      const out = await t.perceive(ids, { gated: true });
      const ans = atomizer.decodeSequence(out, system).trim();
      logger.log(`  ans="${ans}" confidence=${t.lastGateConfidence}`);
      assert.strictEqual(ans, "animal");
      assert.strictEqual(t.lastGateConfidence, "definitive");
    });

    await it("a gated-out salad abstains HEDGED with the candidate preserved", async () => {
      const t = freshTraveler();
      const ids = atomizer.ingestSequence(
        "either the cat is inside or the cat is outside. the cat |-",
        system
      );
      const out = await t.perceive(ids, { gated: true });
      const ans = atomizer.decodeSequence(out, system).trim();
      const candidate = t.lastGateCandidate
        ? atomizer.decodeSequence(t.lastGateCandidate, system).trim()
        : "";
      logger.log(
        `  ans="${ans}" confidence=${t.lastGateConfidence} candidate="${candidate.slice(0, 32)}"`
      );
      assert.strictEqual(ans, "unknown", "the gate must not emit the salad");
      assert.strictEqual(t.lastGateConfidence, "hedged");
      assert.ok(
        candidate.length > 0,
        "the hedged tier must preserve the gated-out candidate"
      );
    });

    await it("a void result abstains SILENT (nothing to hedge)", async () => {
      const t = freshTraveler();
      const ids = atomizer.ingestSequence("blorf glik vex |-", system);
      const out = await t.perceive(ids, { gated: true });
      const ans = atomizer.decodeSequence(out, system).trim();
      logger.log(`  ans="${ans}" confidence=${t.lastGateConfidence}`);
      assert.strictEqual(ans, "unknown");
      assert.notStrictEqual(
        t.lastGateConfidence,
        "definitive",
        "a void result must be an abstention tier"
      );
    });

    await store.close();
  });
}
