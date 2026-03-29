import assert from "node:assert";
import { OperatorClass } from "@core_i/System";
import { DatabaseContext } from "@core_s/DatabaseContext";
import { ManifoldManager } from "@core_s/ManifoldManager";
import { SystemPersistence } from "@core_s/Persistence";
import type SpectralAtomizer from "@atomics/SpectralAtomizer";
import logger from "@utils/SpectralLogger";
import {
  describe,
  it,
  TestHarness,
  type TestEnvironment,
} from "./utils/harness";

export async function executeSignalManagerSuite() {
  await describe("SIGNALING & MANIFOLD MANAGER SUITE", async () => {
    const env: TestEnvironment<SpectralAtomizer> =
      await TestHarness.getEnvironment("spectral");
    const emergencySystem = (await TestHarness.getEnvironment("base")).system;

    const dbCtx = new DatabaseContext(":memory:");
    const dbConn = await dbCtx.connect();
    const persistence = new SystemPersistence(dbConn);
    const manager = new ManifoldManager(
      env.system,
      emergencySystem,
      persistence
    );

    await it("Test 1: RF Spectral Ingestion & Peak Mapping", async () => {
      const samples = new Float32Array(128);
      const targetFreq = 10;
      const sampleRate = 128;
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin(2 * Math.PI * targetFreq * (i / sampleRate));
      }

      const peakIds = env.atomizer.ingestRF(samples, sampleRate, env.system);
      assert.ok(
        peakIds.length > 0,
        "Should detect spectral peaks from sine wave"
      );

      const peakId = peakIds[0];
      const detectedFreq = env.system.scope[peakId];
      const detectedMass = env.system.mass[peakId];
      logger.log(`  [RF] Peak Detected at ID ${peakId}`);
      logger.log(
        `  [RF] Frequency: ${detectedFreq.toFixed(2)}Hz (Target: ${targetFreq}Hz)`
      );
      logger.log(`  [RF] Magnitude (Mass): ${detectedMass.toFixed(2)}`);

      assert.ok(
        Math.abs(detectedFreq - targetFreq) < 1.0,
        "Frequency mapping must be accurate within 1Hz"
      );
      assert.ok(
        detectedMass > 0,
        "Signal amplitude must translate to positive physical Mass"
      );
    });

    await it("Test 2: Telemetry Projection & GPS Drift Navigation", async () => {
      const gps = { lat: 37.7749, lon: -122.4194 };
      const imu = { pitch: 0.1, roll: 0.0, yaw: 0.5 };

      logger.log("  [GPS] Ingesting static position...");
      const normalIds = env.atomizer.ingestTelemetry(
        gps,
        imu,
        false,
        env.system
      );
      assert.strictEqual(
        normalIds.length,
        1,
        "Should create exactly one truth precept for stable GPS"
      );
      assert.strictEqual(env.system.posX[normalIds[0]], gps.lon);
      assert.strictEqual(env.system.posY[normalIds[0]], gps.lat);

      logger.log("  [GPS] Simulating sensor drift / signal jamming...");
      const driftIds = env.atomizer.ingestTelemetry(gps, imu, true, env.system);
      assert.strictEqual(
        driftIds.length,
        2,
        "Should inject a secondary 'Void' precept during drift"
      );
      const voidId = driftIds[1];
      logger.log(
        `  [GPS] Void Precept created at ID ${voidId} with Mass: ${env.system.mass[voidId].toFixed(2)}`
      );

      assert.strictEqual(
        env.system.operatorClass[voidId],
        OperatorClass.Inversion,
        "Drift Void must act as an Inversion (NOT) operator"
      );
      assert.ok(
        env.system.mass[voidId] < 0,
        "Drift Void must have negative mass to repel geodesics"
      );
    });

    await it("Test 3: Triple Modular Redundancy (TMR) Hardware Hardening", async () => {
      logger.log("  [TMR] Pushing IDs into redundant free-list...");
      manager.pushToFreeList(500);
      manager.pushToFreeList(501);

      const firstPop = manager.popFromFreeList();
      assert.strictEqual(
        firstPop,
        501,
        "Majority vote should return last pushed value"
      );

      logger.log("  [TMR] Simulating memory corruption in sub-module A...");
      // @ts-expect-error - accessing private for simulation
      manager.tmrFreeListA.push(9999);

      const securePop = manager.popFromFreeList();
      logger.log(
        `  [TMR] Majority Voter retrieved: ${securePop} (Ignored corrupted 9999)`
      );
      assert.strictEqual(
        securePop,
        500,
        "Voter must successfully ignore the outlier and return the majority consensus"
      );
    });

    await it("Test 4: Emergency Manifold Interrupt & Hot-Swap", async () => {
      assert.strictEqual(
        manager.getActiveSystem(),
        env.system,
        "Initial state must be Primary system"
      );

      logger.log(
        "  [Manager] Injecting supermassive collision-imminent threat..."
      );
      const threatId = env.system.createLocation(env.system.c ** 2 * 5000.0, 0);
      env.system.decayRate[threatId] = 100.0;

      logger.log("  [Manager] Monitoring manifold for critical interrupts...");
      manager.monitorThreats();

      assert.strictEqual(
        manager.getActiveSystem(),
        emergencySystem,
        "Manager must hot-swap to Emergency System when threat detected"
      );
      
      await manager.waitForStability();
    });

    await it("Test 5: Temporal Truth Decay (Matter Half-Life)", async () => {
      const startMass = env.system.c ** 2;
      const startAge = 5.0;
      const startX = 80.0;
      const decayingId = env.system.createLocation(startMass, 20);
      env.system.time[decayingId] = startAge;
      env.system.posX[decayingId] = startX;

      logger.log(
        `  [Decay] Precept ${decayingId} - Initial Mass: ${startMass.toFixed(2)}, Age: ${startAge}`
      );
      logger.log("  [Decay] Advancing system time (dt=50.0)...");
      env.system.decay(50.0);

      const finalMass = env.system.mass[decayingId];
      const finalAge = env.system.time[decayingId];
      const finalX = env.system.posX[decayingId];

      logger.log(
        `  [Decay] Precept ${decayingId} - Final Mass: ${finalMass.toFixed(2)}, Age: ${finalAge.toFixed(2)}`
      );
      assert.ok(
        finalMass < startMass,
        "Mass must decrease according to exponential decay"
      );
      assert.ok(
        finalAge > startAge,
        "Age must increase linearly with simulation time"
      );

      env.system.decayRate[decayingId] = 1.0;
      env.system.decay(1.0);
      logger.log(
        `  [Decay] Spatial position drifted from ${startX} to ${env.system.posX[decayingId].toFixed(2)}`
      );
      assert.ok(
        env.system.posX[decayingId] < startX,
        "Decayed truths must drift toward manifold origin"
      );
    });

    await dbCtx.close();
    await TestHarness.disposeEnvironment(env);
    logger.log("\nSignal & Manager Suite Passed Successfully.");
  });
}
