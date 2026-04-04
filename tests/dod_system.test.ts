import assert from "node:assert/strict";
import type System from "@core_i/System";
import type LogicAtomizer from "@atomics/LogicAtomizer";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

async function testMemoryAlignment(system: System) {
  const f64Buffers: (keyof System)[] = [
    "mass",
    "scope",
    "depth",
    "time",
    "posX",
    "posY",
    "posZ",
    "posW",
    "density",
    "entropyRate",
    "potency",
    "intensity",
    "decayRate",
    "checksum",
  ];

  for (const key of f64Buffers) {
    const buffer = system[key] as Float64Array;
    assert.ok(buffer, `Buffer ${key} is missing`);
    assert.strictEqual(buffer.byteOffset % 8, 0, `Buffer ${key} unaligned`);
  }

  assert.strictEqual(system.PartLayer.byteOffset % 4, 0, "PartLayer unaligned");
  assert.strictEqual(
    system.ComplexLayer.byteOffset % 4,
    0,
    "ComplexLayer unaligned"
  );
}

async function testPointerArithmetic(system: System) {
  const id = system.createLocation(150.5, 2.0);
  const rawView = new DataView(system.buffer);
  const expectedMassOffset =
    system.mass.byteOffset + id * Float64Array.BYTES_PER_ELEMENT;
  const rawMass = rawView.getFloat64(expectedMassOffset, true);
  assert.strictEqual(rawMass, 150.5, "Pointer arithmetic mismatch for mass");
}

async function testPhysicsDeterminism(system: System) {
  const idNormal = system.createLocation(100, 10);
  assert.strictEqual(
    system.density[idNormal],
    100 / 10,
    "Density calculation failed"
  );

  const idZeroScope = system.createLocation(50, 0);
  assert.strictEqual(
    system.density[idZeroScope],
    system.maxilon,
    "Maxilon limit fallback failed"
  );

  const superMassiveId = system.createLocation(system.maxilon * 2, 0.5);
  assert.strictEqual(
    system.density[superMassiveId],
    system.maxilon,
    "Supermassive limit not enforced"
  );
}

async function testAtomizerBidirectional(
  system: System,
  atomizer: LogicAtomizer
) {
  const testString = "p implies q";
  const ids = atomizer.ingestSequence(testString, system);
  assert.strictEqual(ids.length, 3);

  const massP = system.mass[ids[0]];
  const massImplies = system.mass[ids[1]];
  assert.strictEqual(massP, system.epsilon, "Atom mass should be epsilon");
  assert.strictEqual(massImplies, system.c ** 2, "Operator mass should be c^2");

  const decoded = atomizer.decodeSequence(ids, system);
  assert.strictEqual(decoded, testString, "Bidirectional decode failed");
}

async function testMemoryFreeList(system: System) {
  system.reset();
  const id1 = system.createLocation(10, 1);
  const id2 = system.createLocation(20, 2);
  const id3 = system.createLocation(30, 3);

  assert.strictEqual(id1, 0);
  assert.strictEqual(id2, 1);
  assert.strictEqual(id3, 2);

  system.freeLocation(id2);

  const newId = system.createLocation(40, 4);
  assert.strictEqual(newId, id2, "Failed to reuse freed memory location");
  assert.strictEqual(
    system.mass[newId],
    40,
    "Memory view not properly overwritten"
  );
}

export async function executeSuite() {
  await describe("DOD System Core Suite", async () => {
    const env = await TestHarness.getEnvironment("base");

    await it("Verifying 64-bit and 32-bit Memory Alignment (boundaries)", async () => {
      await testMemoryAlignment(env.system);
    });

    await it("Testing Raw Pointer Arithmetic via DataView", async () => {
      await testPointerArithmetic(env.system);
    });

    await it("Testing Physics Determinism & Boundary Limits", async () => {
      await testPhysicsDeterminism(env.system);
    });

    await it("Testing Bidirectional Atomizer (Ingest <-> Decode)", async () => {
      await testAtomizerBidirectional(
        env.system,
        env.atomizer as LogicAtomizer
      );
    });

    await it("Testing Memory Free-list Allocator", async () => {
      await testMemoryFreeList(env.system);
    });

    await TestHarness.disposeEnvironment(env);
    logger.log(
      "\nALL TESTS PASSED: System architecture and memory limits verified."
    );
  });
}
