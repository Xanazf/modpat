type Scalar = number;
type Vector = Scalar[];
type ScalarField = (p: Vector) => Scalar;
type VectorField = (p: Vector) => Vector;
type MetricTensorField = (p: Vector) => (x: Vector, y: Vector) => Scalar; // rank (0, 2)
type CurvedTensorField = (
  p: Vector
) => (x: Vector, y: Vector, z: Vector, transport?: Vector) => Scalar | Vector; // rank (0, 3) or (1, 3)
type TemporalTensorField = (
  p: Vector
) => (x: Vector, y: Vector, z: Vector, w: Vector) => Scalar; // rank (0, 4)

type getScalar = ScalarField;
type getVector = VectorField;
type getMetric_T = MetricTensorField; // (day -> night) = sun.pos += planet.torque
type getCurve_T = CurvedTensorField; // rubik's cube
type getGress_T = TemporalTensorField; // pro-gress, re-gress, ...

// === SYSTEM IMPLEMENTATION ===
/**
 * THE LOGIC METRIC (Metric from Potential)
 * In the Mapper, "logical gravity" is simulated by a potential field.
 * In Differential Geometry, we can view this as a Conformal Transformation
 * of the Euclidean metric: g_ij = exp(2 * Phi) * delta_ij
 *
 * Where Phi is the 'potential' derived from density.
 * High density = negative Phi = contracted space = logical attraction.
 */
const getLogicMetric = (potential: ScalarField): getMetric_T => {
  return (p: Vector) => {
    const phi = potential(p);
    const scale = Math.exp(2 * phi);
    return (v1: Vector, v2: Vector) => {
      // Euclidean dot product scaled by the logical potential
      return scale * v1.reduce((acc, val, i) => acc + val * v2[i], 0);
    };
  };
};

/**
 * TEMPORAL ANISOTROPY (The W-Dimension / Arrow of Logic)
 * System.ts uses posW (Age) to represent temporal context.
 * Mapper.ts implements an "Arrow of Logic" (influence decays if moving "backward" in time).
 *
 * This creates a geometry where the metric depends on the direction of travel (velocity v).
 */
const getAnisotropicMetric = (p: Vector, v: Vector): number[][] => {
  const n = p.length;
  const g = Array.from({ length: n }, () => new Array(n).fill(0));

  // Base metric is Euclidean
  for (let i = 0; i < n; i++) g[i][i] = 1.0;

  // The 'W' dimension (index 3) is special.
  // If velocity in W is negative (v[3] < 0), we increase the "cost" of space.
  const ageVelocity = v[3];
  if (ageVelocity < 0) {
    // Moving against the Arrow of Logic is physically "harder"
    g[3][3] = 1000.0;
  }

  return g;
};

/**
 * SDF GRADIENT (The Surface Normal)
 * In Signed Distance Fields, the gradient is the unit normal to the surface.
 * Mathematically: n = grad(f) / |grad(f)|
 * This satisfies the Eikonal Equation: |grad(f)| = 1
 */
function computeSDFNormal(sdf: ScalarField, p: Vector): Vector {
  const h = Number.EPSILON * 1e4;
  const grad = new Array(p.length).fill(0);

  for (let i = 0; i < p.length; i++) {
    const pPlus = [...p];
    pPlus[i] += h;
    const pMinus = [...p];
    pMinus[i] -= h;
    grad[i] = (sdf(pPlus) - sdf(pMinus)) / (2 * h);
  }

  const magnitude = Math.sqrt(grad.reduce((acc, v) => acc + v * v, 0));
  return magnitude < 1e-10 ? grad : grad.map(v => v / magnitude);
}

/**
 * LOGICAL POTENTIAL GRADIENT (The Force in Mapper.ts)
 * Mapper.ts uses gradient descent to move path nodes.
 * Force F = -grad(Potential).
 * This is how path nodes "fall" into logical attractors.
 */
function computeMapperForce(potential: ScalarField, p: Vector): Vector {
  const h = 1e-5;
  const force = new Array(p.length).fill(0);
  const d0 = potential(p);

  for (let i = 0; i < p.length; i++) {
    const pShift = [...p];
    pShift[i] += h;
    // Force is negative gradient
    force[i] = -(potential(pShift) - d0) / h;
  }
  return force;
}

/**
 * THE HESSIAN TENSOR (Logical Curvature)
 * The Hessian (H_ij = d_i * d_j * f) measures the second-order structure.
 * Mapper.ts uses this implicitly to find "Traps" (local minima/maxima).
 *
 * Trap Detection Logic:
 * If all eigenvalues of H are positive, we are at a stable local minimum (a sink).
 * If the density is high but entropy is low, it's a "Logic Trap".
 */
function computeHessian(f: ScalarField, p: Vector): number[][] {
  const h = 1e-4;
  const n = p.length;
  const hessian = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        // Diagonal: d^2 f / dx_i^2
        const pPlus = [...p];
        pPlus[i] += h;
        const pMinus = [...p];
        pMinus[i] -= h;
        hessian[i][j] = (f(pPlus) - 2 * f(p) + f(pMinus)) / (h * h);
      } else {
        // Off-diagonal: d^2 f / (dx_i dx_j)
        const pPP = [...p];
        pPP[i] += h;
        pPP[j] += h;
        const pPM = [...p];
        pPM[i] += h;
        pPM[j] -= h;
        const pMP = [...p];
        pMP[i] -= h;
        pMP[j] += h;
        const pMM = [...p];
        pMM[i] -= h;
        pMM[j] -= h;
        hessian[i][j] = (f(pPP) - f(pPM) - f(pMP) + f(pMM)) / (4 * h * h);
      }
    }
  }
  return hessian;
}

/**
 * SHAPE OPERATOR (SDF Curvature)
 * Measures how the normal vector changes as you move along the surface.
 * S = -grad(n)
 * The eigenvalues of S are the principal curvatures (k1, k2).
 * Mean Curvature H = (k1 + k2) / 2 = div(n) / 2
 */
function computePrincipalCurvatures(sdf: ScalarField, p: Vector): number {
  const nField = (pos: Vector) => computeSDFNormal(sdf, pos);

  // divergence of normal field
  let divN = 0;
  const h = 1e-5;
  for (let i = 0; i < p.length; i++) {
    const pPlus = [...p];
    pPlus[i] += h;
    const pMinus = [...p];
    pMinus[i] -= h;
    divN += (nField(pPlus)[i] - nField(pMinus)[i]) / (2 * h);
    console.log(`divN[${i}]: `, divN);
  }

  return divN; // Related to mean curvature
}

/**
 * REYNOLDS TRANSPORT THEOREM (Analogy for System.ts)
 * System.ts implements `decay()`. This is essentially a transport equation
 * where mass (logical importance) flows and dissipates.
 *
 * d/dt Integral_V(density) = Integral_V(d_density/dt) + Integral_S(density * v dot n)
 *
 * This maps to:
 * this.mass[i] *= Math.exp(-rate * deltaTime); // Dissipation
 * this.posX[i] *= 0.9; // Drift towards origin
 */

// === EXPORT/USAGE EXAMPLES ===

/**
 * Surface Detection
 * A sphere at origin with radius 1.0.
 */
const exampleSDF = (p: Vector) => {
  const dist = Math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2);
  return dist - 1.0;
};

console.log("--- SDF DEMONSTRATION ---");
const pOutside: Vector = [1.5, 0, 0];
const pOnSurface: Vector = [1.0, 0, 0];
const pInside: Vector = [0.5, 0, 0];

[pOutside, pOnSurface, pInside].forEach(p => {
  const d = exampleSDF(p);
  const n = computeSDFNormal(exampleSDF, p);
  const state = d > 0 ? "OUTSIDE" : d < 0 ? "INSIDE" : "SURFACE";
  console.log(
    `Point ${p}: dist=${d.toFixed(2)} (${state}), normal=${n.map(v => v.toFixed(2))}`
  );
});

/**
 * Derivation vs. Traps
 * Demonstrates how high mass and low entropy create "sinks" in the manifold.
 */
const exampleLogicPotential = (p: Vector) => {
  const attractors = [
    { pos: [0, 0, 0, 0], mass: 5.0, entropy: 0.1 }, // A stable premise
    { pos: [1, 1, 1, 1], mass: 20.0, entropy: 0.01 }, // A LOGIC TRAP: High mass, near-zero entropy
  ];

  let potential = 1.0;
  for (const a of attractors) {
    const dx = p[0] - a.pos[0],
      dy = p[1] - a.pos[1],
      dz = p[2] - a.pos[2],
      dw = p[3] - a.pos[3];
    const distSq = dx * dx + dy * dy + dz * dz + dw * dw;

    if (distSq < 2.0) {
      let influence = a.mass * 1.5;
      if (a.pos[3] < p[3] - 0.01) influence *= 0.01; // Arrow of Logic
      influence *= Math.exp(-Math.pow(dw * 10.0, 2));
      potential -= influence * Math.exp(-distSq / 0.5);
    }
  }
  return Math.max(0.01, potential);
};

console.log("\n--- LOGIC DEMONSTRATION ---");
const pNormal: Vector = [0.2, 0.2, 0.2, 0.2];
const pTrap: Vector = [1.0, 1.0, 1.0, 1.0];

[pNormal, pTrap].forEach(p => {
  const pot = exampleLogicPotential(p);
  const f = computeMapperForce(exampleLogicPotential, p);
  const h = computeHessian(exampleLogicPotential, p);
  const density = 1.0 / pot; // Inverse potential as a proxy for logic density

  console.log(
    `Point ${p}: potential=${pot.toFixed(4)}, force_mag=${Math.sqrt(f.reduce((a, v) => a + v * v, 0)).toFixed(2)}`
  );
  if (isLogicTrap(h, density)) {
    console.log(
      ">> ALERT: Logic Trap Detected (Local Minimum with High Density) <<"
    );
  } else {
    console.log("Status: Normal Geodesic Flow");
  }
});

/**
 * Modulated Temporal Attenuation
 * Shows how moving "Backward" in time (decreasing W) encounters massive resistance.
 */
console.log("\n--- TEMPORAL ANISOTROPY (Arrow of Logic) ---");
const pos: Vector = [0, 0, 0, 1.0];
const vForward: Vector = [0, 0, 0, 0.1]; // Moving into the future
const vBackward: Vector = [0, 0, 0, -0.1]; // Moving into the past

const gForward = getAnisotropicMetric(pos, vForward);
const gBackward = getAnisotropicMetric(pos, vBackward);

console.log(`Moving Forward in Time: ds^2 (W-component) = ${gForward[3][3]}`);
console.log(
  `Moving Backward in Time: ds^2 (W-component) = ${gBackward[3][3]} (MASSIVE RESISTANCE)`
);

/**
 * Detector (Analogue to Mapper.review)
 */
function isLogicTrap(h: number[][], density: number): boolean {
  const trace = h.reduce((acc, row, i) => acc + row[i], 0);
  // In our potential field, a local minimum (potential sink) has a positive trace (Laplacian > 0)
  // Logic Traps are areas where paths get "stuck" due to extreme attraction but zero entropy.
  return density > 15.0 && trace > 10.0;
}
