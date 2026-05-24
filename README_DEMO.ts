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
type getMetric_T = MetricTensorField; // Metric tensor mapping
type getCurve_T = CurvedTensorField; // Curvature tensor mapping
type getGress_T = TemporalTensorField; // Temporal/process tensor mapping

// === SYSTEM IMPLEMENTATION ===
/**
 * THE LOGIC METRIC (Metric from Potential)
 * In Traveler.ts, coordinate path optimization is driven by a potential field.
 * In Differential Geometry, we can view this as a conformal transformation
 * of the Euclidean metric:
 *
 *   $$g_{ij} = e^{2\phi} \delta_{ij}$$
 *
 * where $\phi$ is the potential derived from local density.
 * High density $\Rightarrow$ negative $\phi$ $\Rightarrow$ contracted space $\Rightarrow$ logical attraction.
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
 * TEMPORAL ANISOTROPY (The W-Dimension)
 * System.ts uses posW (Age) to represent temporal context.
 * Traveler.ts implements temporal anisotropy: influence of past events decays as
 * the Traveler moves forward in time (away from target).
 *
 * This creates a Finsler-like geometry where the metric depends on the direction
 * of travel (velocity $v$). Moving backward in $W$ increases $g_{33}$ by a
 * factor of $1000$, making retrograde inferences physically "harder".
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
    // Moving against the Temporal Anisotropy is physically "harder"
    g[3][3] = 1000.0;
  }

  return g;
};

/**
 * SDF GRADIENT (The Surface Normal)
 * In Signed Distance Fields, the gradient is the unit normal to the surface:
 *
 *   $$\mathbf{n} = \frac{\nabla f}{|\nabla f|}$$
 *
 * This satisfies the Eikonal equation: $|\nabla f| = 1$.
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
 * LOGICAL POTENTIAL GRADIENT (The Force in Traveler.ts)
 * Traveler's locomotion uses gradient descent to move path nodes:
 *
 *   $$\mathbf{F} = -\nabla\Phi$$
 *
 * Path nodes "fall" into logical attractors along $-\nabla\Phi$.
 * The conformal metric amplifies this force by $e^{-2\phi}$ near high-density zones.
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
 * The Hessian $H_{ij} = \partial_i \partial_j f$ measures second-order structure.
 * Traveler.ts checks for "Traps" using high-density and low-entropy thresholds
 * on the nearest attractors along the relaxed path.
 *
 * Trap detection (conceptual):
 * - If all eigenvalues of $H$ are positive $\Rightarrow$ stable local minimum (sink).
 * - High density + low entropy $\Rightarrow$ "Logic Trap" (circular definition).
 * - Operationally: $\mathrm{tr}(H) > 10$ and $\rho > 15$ triggers trap bypass.
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
 * Measures how the normal vector changes as you move along the surface:
 *
 *   $$S = -\nabla \mathbf{n}$$
 *
 * The eigenvalues of $S$ are the principal curvatures $k_1, k_2$.
 * Mean curvature: $H = (k_1 + k_2)/2 = \nabla \cdot \mathbf{n} / 2$.
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
  }

  return divN; // Related to mean curvature
}

/**
 * SYSTEM DECAY DYNAMICS (Decay in System.ts)
 * System.ts implements a decay function on each step:
 * 1. Mass decays exponentially: $m_i \leftarrow m_i \cdot e^{-\lambda \Delta t}$
 * 2. Spatial coordinates drift back toward the origin: $x_i \leftarrow 0.9\,x_i$
 *
 * This prevents the manifold from accumulating unbounded mass and ensures that
 * infrequently-visited precepts fade, maintaining a "forgetting curve" analogous
 * to the Ebbinghaus model.
 */

/**
 * SCALAR CURVATURE (Curvature.ts — phase C1)
 * The conformal metric $g_{ij} = e^{2\phi} \delta_{ij}$ has scalar curvature:
 *
 *   $$R = -6\,e^{-2\phi}\!\left(\nabla^2\phi + |\nabla\phi|^2\right)$$
 *
 * Zones of large $|R|$ are targeted first by the dream/expansion cycle (C2).
 * Ricci flow smooths these zones: $\rho_i \mathrel{-}= \eta \cdot \mathrm{clamp}(R_i, \pm R_{\max})$ (C3).
 */

/**
 * LEARNED CHRISTOFFEL SYMBOLS (Traveler.ts — phase C4)
 * The Traveler maintains a $4 \times 4 \times 4$ correction tensor
 * $\Delta\Gamma^{i}_{jk}$ trained from traversal history.
 * At each path step, the geodesic deviation is added to the gradient force:
 *
 *   $$\delta F^i = \sum_{j,k} \Delta\Gamma^{i}_{jk}\,v^j v^k$$
 *
 * Successful traversals increment $\Delta\Gamma$ along the mean unit velocity;
 * failed traversals and trap detections decrement it.
 * $L_2$ regularization ($\times 0.99$ per learn cycle) prevents overfitting.
 */

/**
 * PARALLEL TRANSPORT AND HOLONOMY (Traveler.ts — phase D2)
 * After each call to `relaxPath()`, the Traveler computes the holonomy matrix
 * $H \in SO(4)$ by composing 4D plane rotations (via Rodrigues formula) along
 * successive tangent vectors of the path:
 *
 *   $$H = \prod_{k} R(u_k \to u_{k+1})$$
 *
 * Inferential effort is $\|H - I\|_F / 4 \in [0, 1]$:
 * - $0$ = straight geodesic (pure deduction)
 * - $\approx 1$ = maximally winding path (creative / analogical inference)
 *
 * The session-level $\mathrm{holonomyFrame}$ accumulates $H$ across all traversals
 * and is re-orthogonalised every 10 calls via Gram-Schmidt.
 */

/**
 * PATH HOMOTOPY AND ANALOGY (Traveler.ts — phase D3)
 * Two paths $\gamma_A$ and $\gamma_B$ sharing start/end atoms are homotopic
 * (equivalent inferences) when their loop $\gamma_A \cdot \gamma_B^{-1}$ has
 * winding number 0 around every persistent $H_1$ generator.
 *
 * Non-zero winding $\Rightarrow$ the paths are genuinely distinct inferences
 * that loop around a topological hole $\Rightarrow$ analogy candidate.
 *
 *   $$\mathrm{analogyScore} = \frac{|\text{straddled generators}|}{|\text{qualified generators}|} \in [0, 1]$$
 */

/**
 * Detector (analogue to Traveler's trap detection)
 * A sink is a logic trap when density $\rho > 15$ and $\mathrm{tr}(H) > 10$
 * (positive Laplacian of the potential = local minimum with near-zero entropy).
 */
function isLogicTrap(h: number[][], density: number): boolean {
  const trace = h.reduce((acc, row, i) => acc + row[i], 0);
  return density > 15.0 && trace > 10.0;
}

// === EXPORT/USAGE EXAMPLES ===

/**
 * Surface Detection
 * SDF for a sphere at the origin with radius $r = 1$: $f(\mathbf{p}) = |\mathbf{p}| - 1$.
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
 * Demonstrates how high mass and low entropy create sinks:
 * attractor at $\mathbf{p}_1=(0,0,0,0)$ with $m=5, S=0.1$ (normal premise) vs.
 * attractor at $\mathbf{p}_2=(1,1,1,1)$ with $m=20, S=0.01$ (logic trap).
 */
const smoothMax = (x: number): number => {
  // Smooth approximation to max(0, x) using algebraic approximation
  // to preserve differentiability during Hessian calculation.
  return (x + Math.sqrt(x * x + 1e-4)) / 2;
};

const exampleLogicPotentialUnclipped = (p: Vector): number => {
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
      // Smooth temporal decay: exp(-PHI_TEMPORAL_DECAY * max(0, pw_probe - pw_atom))
      influence *= Math.exp(-3.0 * smoothMax(p[3] - a.pos[3]));
      potential -= influence * Math.exp(-distSq / 0.5);
    }
  }
  return potential;
};

const exampleLogicPotential = (p: Vector): number => {
  return Math.max(0.01, exampleLogicPotentialUnclipped(p));
};

console.log("\n--- LOGIC DEMONSTRATION ---");
const pNormal: Vector = [0.2, 0.2, 0.2, 0.2];
const pTrap: Vector = [1.0, 1.0, 1.0, 1.0];

[pNormal, pTrap].forEach(p => {
  const pot = exampleLogicPotential(p);
  const f = computeMapperForce(exampleLogicPotentialUnclipped, p);
  const h = computeHessian(exampleLogicPotentialUnclipped, p);
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
 * Shows how moving backward in $W$ (decreasing time coordinate) is penalized.
 * Forward: $g_{33} = 1$. Backward: $g_{33} = 1000$ (massive resistance).
 */
console.log("\n--- TEMPORAL ANISOTROPY ---");
const pos: Vector = [0, 0, 0, 1.0];
const vForward: Vector = [0, 0, 0, 0.1]; // Moving into the future
const vBackward: Vector = [0, 0, 0, -0.1]; // Moving into the past

const gForward = getAnisotropicMetric(pos, vForward);
const gBackward = getAnisotropicMetric(pos, vBackward);

console.log(`Moving Forward in Time: ds^2 (W-component) = ${gForward[3][3]}`);
console.log(
  `Moving Backward in Time: ds^2 (W-component) = ${gBackward[3][3]} (MASSIVE RESISTANCE)`
);
