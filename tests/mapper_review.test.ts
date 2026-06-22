import assert from "node:assert";
import Traveler from "@core_i/Traveler";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function runTravelerReviewTest() {
  await describe("Traveler Review Suite", async () => {
    const env = await TestHarness.getEnvironment("semantic");

    await it("GeodesicTraveler Self-Review & Self-Correction", async () => {
      const alphaId = env.atomizer.ingestSequence("alpha", env.system)[0];
      const betaId = env.atomizer.ingestSequence("beta", env.system)[0];

      env.system.posX[alphaId] = 0;
      env.system.posY[alphaId] = 0;
      env.system.posZ[alphaId] = 0.5;

      env.system.posX[betaId] = 100;
      env.system.posY[betaId] = 0;
      env.system.posZ[betaId] = 0.5;

      const trapId = env.atomizer.ingestSequence("trap", env.system)[0];
      env.system.posX[trapId] = 50;
      env.system.posY[trapId] = 0;
      env.system.mass[trapId] = env.system.c ** 2 * 1000.0;
      // High mass + low entropyRate = Logic Trap
      env.system.time[trapId] = 0.0;
      env.system.scope[trapId] = 1.0;
      env.system.update(trapId);

      const mapper = new Traveler(env.system);
      const path = await mapper.route(alphaId, betaId, {
        steps: 32,
        verbose: true,
      });

      const pathTokens = env.atomizer.decodeSequence(path, env.system);
      logger.log(`Calculated Path: ${pathTokens}`);
      assert.ok(!pathTokens.toLowerCase().includes("trap"));
    });

    await it("Relaxed path's discrete action decreases monotonically", async () => {
      const alphaId = env.atomizer.ingestSequence("alpha", env.system)[0];
      const betaId = env.atomizer.ingestSequence("beta", env.system)[0];

      env.system.posX[alphaId] = 0;
      env.system.posY[alphaId] = 0;
      env.system.posZ[alphaId] = 0.5;
      env.system.posW[alphaId] = 0.0;

      env.system.posX[betaId] = 10;
      env.system.posY[betaId] = 0;
      env.system.posZ[betaId] = 0.5;
      env.system.posW[betaId] = 5.0;

      const mapper = new Traveler(env.system);
      mapper.buildGridIndex();

      const steps = 16;
      const px = new Float64Array(steps + 1);
      const py = new Float64Array(steps + 1);
      const pe = new Float64Array(steps + 1);
      const pa = new Float64Array(steps + 1);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        px[i] =
          env.system.posX[alphaId] +
          t * (env.system.posX[betaId] - env.system.posX[alphaId]);
        py[i] =
          env.system.posY[alphaId] +
          t * (env.system.posY[betaId] - env.system.posY[alphaId]);
        pe[i] =
          env.system.posZ[alphaId] +
          t * (env.system.posZ[betaId] - env.system.posZ[alphaId]);
        pa[i] =
          env.system.posW[alphaId] +
          t * (env.system.posW[betaId] - env.system.posW[alphaId]);
      }

      function calculateDiscreteAction(): number {
        let action = 0;
        for (let i = 1; i <= steps; i++) {
          const dx = px[i] - px[i - 1];
          const dy = py[i] - py[i - 1];
          const de = pe[i] - pe[i - 1];
          const da = pa[i] - pa[i - 1];
          action += dx * dx + dy * dy + de * de + da * da;
        }
        for (let i = 1; i < steps; i++) {
          const [V] = mapper.getMetricForce(
            px[i],
            py[i],
            pe[i],
            pa[i],
            [],
            undefined
          );
          action += 2.0 * V;
        }
        return action;
      }

      const actions: number[] = [];
      const lr = 0.01;

      for (let iter = 0; iter < 20; iter++) {
        actions.push(calculateDiscreteAction());

        for (let i = 1; i < steps; i++) {
          const [, fx, fy, fz, fw] = mapper.getMetricForce(
            px[i],
            py[i],
            pe[i],
            pa[i],
            [],
            undefined
          );

          const sx = (px[i - 1] + px[i + 1]) / 2 - px[i];
          const sy = (py[i - 1] + py[i + 1]) / 2 - py[i];
          const se = (pe[i - 1] + pe[i + 1]) / 2 - pe[i];
          const sa = (pa[i - 1] + pa[i + 1]) / 2 - pa[i];

          px[i] += lr * (sx * 2.0 - fx);
          py[i] += lr * (sy * 2.0 - fy);
          pe[i] += lr * (se * 2.0 - fz);
          pa[i] += lr * (sa * 2.0 - fw);
        }
      }

      for (let i = 1; i < actions.length; i++) {
        assert.ok(
          actions[i] <= actions[i - 1] + 1e-9,
          `Discrete action must decrease monotonically: step ${i} (${actions[i]}) was larger than step ${i - 1} (${actions[i - 1]})`
        );
      }
    });

    await TestHarness.disposeEnvironment(env);
  });
}
