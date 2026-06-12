import { multiplyMatrices4x4, transposeMatrix4x4 } from "@_lib/math/TensorMath";
import assert from "node:assert/strict";
import System from "@core_i/System";
import type { PersistenceBar } from "@core_s/PersistentHomology";
import {
  ProofPath,
  pathEqual,
  refl,
  symm,
  trans,
} from "@i_topology/HoTTKernel";
import { describe, it } from "./utils/harness";

// helpers

function frobDist(A: Float64Array, B: Float64Array): number {
  let s = 0;
  for (let i = 0; i < 16; i++) {
    const d = A[i] - B[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function identity4x4(): Float64Array {
  const I = new Float64Array(16);
  I[0] = I[5] = I[10] = I[15] = 1;
  return I;
}

/** Build a rotation matrix for angle θ in the (0,1) plane of a 4×4. */
function rotation4x4(theta: number): Float64Array {
  const R = identity4x4();
  R[0] = Math.cos(theta);
  R[1] = -Math.sin(theta);
  R[4] = Math.sin(theta);
  R[5] = Math.cos(theta);
  return R;
}

function makeSystem(): System {
  return new System();
}

function addAtom(sys: System, x: number, y: number, z = 0, w = 0.5): number {
  const id = sys.createLocation(1.0, 1.0);
  sys.posX[id] = x;
  sys.posY[id] = y;
  sys.posZ[id] = z;
  sys.posW[id] = w;
  sys.update(id);
  return id;
}

// tests

export async function runHoTTKernelTests() {
  await describe("E3 – HoTT kernel", async () => {
    // multiplyMatrices4x4

    await it("multiplyMatrices4x4: I × I = I", async () => {
      const I = identity4x4();
      const R = multiplyMatrices4x4(I, I);
      assert.ok(frobDist(R, I) < 1e-9, "I × I should equal I");
    });

    await it("multiplyMatrices4x4: R(θ) × R(θ)ᵀ = I for rotation", async () => {
      const theta = Math.PI / 6;
      const R = rotation4x4(theta);
      const Rt = transposeMatrix4x4(R);
      const prod = multiplyMatrices4x4(R, Rt);
      assert.ok(frobDist(prod, identity4x4()) < 1e-9, "R × Rᵀ should equal I");
    });

    await it("transposeMatrix4x4: double transpose = identity", async () => {
      const R = rotation4x4(Math.PI / 4);
      const Rtt = transposeMatrix4x4(transposeMatrix4x4(R));
      assert.ok(frobDist(R, Rtt) < 1e-9, "(Rᵀ)ᵀ should equal R");
    });

    // refl

    await it("refl: zero-length path, identity holonomy", async () => {
      const p = refl(42 as 42);
      assert.strictEqual(p.from, 42);
      assert.strictEqual(p.to, 42);
      assert.strictEqual(p.path.length, 1);
      assert.strictEqual(p.path[0], 42);
      assert.strictEqual(p.energy, 0);
      assert.ok(
        frobDist(p.holonomy, identity4x4()) < 1e-9,
        "refl holonomy should be identity"
      );
    });

    // symm

    await it("symm: reverses path and transposes holonomy", async () => {
      const theta = Math.PI / 3;
      const H = rotation4x4(theta);
      const p = new ProofPath(1 as 1, 5 as 5, [1, 2, 3, 4, 5], H, 2.5);
      const ps = symm(p);

      assert.strictEqual(ps.from, 5);
      assert.strictEqual(ps.to, 1);
      assert.deepStrictEqual(ps.path, [5, 4, 3, 2, 1]);
      assert.strictEqual(ps.energy, p.energy);

      // Holonomy of symm(p) = transpose of p's holonomy
      assert.ok(
        frobDist(ps.holonomy, transposeMatrix4x4(H)) < 1e-9,
        "symm holonomy should be transpose of original"
      );
    });

    await it("symm: holonomy of symm(p) satisfies H × Hᵀ ≈ I", async () => {
      const H = rotation4x4(Math.PI / 5);
      const p = new ProofPath(0 as 0, 1 as 1, [0, 1], H, 1.0);
      const ps = symm(p);
      const prod = multiplyMatrices4x4(p.holonomy, ps.holonomy);
      assert.ok(
        frobDist(prod, identity4x4()) < 1e-9,
        "H × Hᵀ should equal I for rotation holonomy"
      );
    });

    // compose (trans)

    await it("compose: paths are concatenated without duplicate midpoint", async () => {
      const I = identity4x4();
      const p = new ProofPath(1 as 1, 3 as 3, [1, 2, 3], I, 1.0);
      const q = new ProofPath(3 as 3, 5 as 5, [3, 4, 5], I, 1.5);
      const r = p.compose(q);

      assert.strictEqual(r.from, 1);
      assert.strictEqual(r.to, 5);
      assert.deepStrictEqual(r.path, [1, 2, 3, 4, 5]); // midpoint 3 not duplicated
    });

    await it("compose: energies sum", async () => {
      const I = identity4x4();
      const p = new ProofPath(0 as 0, 1 as 1, [0, 1], I, 1.5);
      const q = new ProofPath(1 as 1, 2 as 2, [1, 2], I, 2.5);
      const r = p.compose(q);
      assert.ok(Math.abs(r.energy - 4.0) < 1e-9);
    });

    await it("compose: holonomies multiply correctly", async () => {
      const theta1 = Math.PI / 4;
      const theta2 = Math.PI / 3;
      const H1 = rotation4x4(theta1);
      const H2 = rotation4x4(theta2);
      const p = new ProofPath(0 as 0, 1 as 1, [0, 1], H1, 0);
      const q = new ProofPath(1 as 1, 2 as 2, [1, 2], H2, 0);
      const r = p.compose(q);

      const expected = multiplyMatrices4x4(H1, H2);
      assert.ok(
        frobDist(r.holonomy, expected) < 1e-9,
        "Composed holonomy should be H1 × H2"
      );
    });

    await it("trans: same as compose", async () => {
      const I = identity4x4();
      const p = new ProofPath(0 as 0, 1 as 1, [0, 1], I, 1.0);
      const q = new ProofPath(1 as 1, 2 as 2, [1, 2], I, 2.0);
      const r1 = trans(p, q);
      const r2 = p.compose(q);
      assert.deepStrictEqual(r1.path, r2.path);
      assert.strictEqual(r1.energy, r2.energy);
      assert.ok(frobDist(r1.holonomy, r2.holonomy) < 1e-9);
    });

    // pathEqual

    await it("pathEqual: identical paths are homotopic", async () => {
      const sys = makeSystem();
      const a = addAtom(sys, 0, 0);
      const b = addAtom(sys, 10, 0);
      const c = addAtom(sys, 5, 5);
      const I = identity4x4();
      const p = new ProofPath(a as typeof a, b as typeof b, [a, c, b], I, 1.0);
      const h1Bars: PersistenceBar[] = [];
      const result = pathEqual(sys, p, p, h1Bars);
      assert.ok(result.homotopic, "Identical paths should be homotopic");
      assert.strictEqual(result.analogyScore, 0);
    });

    await it("pathEqual: no H₁ bars always returns homotopic", async () => {
      const sys = makeSystem();
      const a = addAtom(sys, 0, 0);
      const b = addAtom(sys, 10, 0);
      const I = identity4x4();
      const p = new ProofPath(a as typeof a, b as typeof b, [a, b], I, 0.5);
      const q = new ProofPath(a as typeof a, b as typeof b, [a, b], I, 0.5);
      const result = pathEqual(sys, p, q, []);
      assert.ok(result.homotopic, "No H₁ bars → always homotopic");
    });

    await it("pathEqual: loop enclosing an H₁ generator → not homotopic", async () => {
      const sys = makeSystem();
      // Place a generator atom in the center of the loop.
      const gen = addAtom(sys, 5, 5);
      // Path A goes above the generator.
      const aStart = addAtom(sys, 0, 0);
      const aTop = addAtom(sys, 5, 10);
      const aEnd = addAtom(sys, 10, 0);
      // Path B goes below the generator (will form a loop that encloses gen).
      const bBot = addAtom(sys, 5, -2);
      const I = identity4x4();
      const p = new ProofPath(
        aStart as typeof aStart,
        aEnd as typeof aEnd,
        [aStart, aTop, aEnd],
        I,
        1.0
      );
      const q = new ProofPath(
        aStart as typeof aStart,
        aEnd as typeof aEnd,
        [aStart, bBot, aEnd],
        I,
        1.0
      );
      const h1Bars: PersistenceBar[] = [
        { birth: 0, death: 100, generatorAtomId: gen },
      ];
      const result = pathEqual(sys, p, q, h1Bars);
      assert.ok(
        !result.homotopic,
        "Loop enclosing H₁ generator should not be homotopic"
      );
      assert.ok(result.analogyScore > 0, "analogyScore should be > 0");
    });
  });
}
