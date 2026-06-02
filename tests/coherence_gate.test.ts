/**
 * Phase 2 - coherence score separation.
 *
 * Before the score can gate emission it must demonstrably separate coherent
 * traversals (clean geodesic through faithful terrain) from incoherent ones
 * (threading a collapsed / over-packed region, or winding heavily). This builds
 * both kinds of terrain in a real System and checks the score tells them apart -
 * the same "prove the mechanism in isolation first" discipline as Phase 1.
 */

import assert from "node:assert";
import System from "@core_i/System";
import { GridIndex4D } from "@mutate/GridIndex4D";
import { pathCoherence } from "@skill_cogi/Coherence";
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
  });
}
