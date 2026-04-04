/** WARN:
 *  This file is for reference and should NEVER BE DELETED.
 *  Maps formal geometry to proposed ModPAT architecture.
 */

// === TYPES ===

/**
 * Represents a point or vector in N-dimensional space.
 */
type Scalar = number;
type Vector = Scalar[];

// NOTE:  "field" = function

/**
 * A Scalar Field maps a Vector on the manifold to a value.
 * Represents the origin of a Vector, e.g. "density".
 * The Higgs Field is this thing.
 * (the Higgs "Field" is actually a function, programmatically, of a Higgs vector)
 * f: v => s_v
 */
type ScalarField = (p: Vector) => Scalar;
type getScalar = ScalarField;

/**
 * A Vector Field maps a Vector on the manifold to another Vector.
 * Represents a transition map between a Vector and its' future, e.g. "density * entropyRate".
 * f: v[i] * t[i] => v
 */
type VectorField = (p: Vector) => Vector;
type getVector = VectorField;

/**
 * A Tensor Field maps a Vector Field on the manifold to another Vector Field.
 * Represents a path across the manifold.
 * f: (x[i] * y[i+1]) => v
 */
type MetricTensorField = (p: Vector) => (x: Vector, y: Vector) => Scalar; // rank (0, 2)
type CurvedTensorField = (
  p: Vector
) => (x: Vector, y: Vector, z: Vector, transport?: Vector) => Scalar | Vector; // rank (0, 3) or (1, 3)
type TemporalTensorField = (
  p: Vector
) => (x: Vector, y: Vector, z: Vector, w: Vector) => Scalar; // rank (0, 4)

type getMetric_T = MetricTensorField; // (day -> night) = sun.pos += planet.torque
type getCurve_T = CurvedTensorField; // rubik's cube
type getGress_T = TemporalTensorField; // pro-gress, re-gress, ...

/**
 * Covariant (Connected) Field
 * Represents a correction (derivative, d) between connected dimensions.
 * h = Number.EPSILON * 1e4 (shifted for security)
 * f_c0: (p[i] - p[-i]) / (2*h) => d_p
 * f_c1: (v[i] * t[i]) * p[i] * d_p[i] => d_v
 */
type CovariantField = (
  transform: getVector,
  direction: Vector,
  p: Vector
) => Vector;
type getConnect = CovariantField;

/**
 * A Lie Derivative ([u, v] at point p)
 * Represents the changes happening during travel of Vector1 along Vector2.
 * f_l0: (j[i] - j[-i]) / (2*h) => d_j
 * f: (u^j * f_l0 * v^k) - (v^j * f_l0 * u^k) => uv_k
 */
type LieDerivative = (
  uField: VectorField,
  vField: VectorField,
  p: Vector
) => Vector;

/**
 * Differential Forms (translated corrections)
 * Represent changes at different thresholds and projection targets.
 * h = Number.EPSILON * 1e4 (shifted for security)
 * f_d0: (v[s_v] - (v[-s_v])) / (2*h) => d_s
 * f_d1: v[s_v] * d_s => d_v
 */
type DifferentialForm0 = ScalarField; // 0 -> 0.04354... -> 1
type DifferentialForm1 = (p: Vector) => ScalarField; // it's an enum

/**
 * Exterior Derivative Field
 * Represents the gradient of a Vector's "connectivity" to other Vectors on the manifold.
 * f_e0: f_d0(s_u) => d_s
 * f_e1: f_d1(u)(v) * d_s = d_uv
 */
type ExteriorDerivativeField = (f: DifferentialForm0) => DifferentialForm1;
type getExterior0_1 = ExteriorDerivativeField;

// === HELPERS ===

function rotate90(
  v: Vector,
  metricLocal: (v1: Vector, v2: Vector) => number
): Vector {
  // Logic to find a vector w such that metric(v, w) = 0 and |w| = |v|
  return [-v[1], v[0]]; // Simplified for 2D Euclidean
}

/**
 * 1. THE RIEMANNIAN METRIC (represented as g)
 * This defines the 'dot product' at any point p.
 * In Graphics: Used for texture mapping/stretching.
 * In Physics: Represents the gravitational potential.
 * In practice: takes 2 vectors and returns their dot product.
 * @param p - the local ruler; the "event"; the "location".
 * @param v1 - vector tangential to p.
 * @param v2 - vector tangential to p.
 * @returns - a number that is the result of the dot product.
 */
function getEuclideanMetric(p: Vector): getMetric_T {
  // given a ruler "p", the metric of (v1,v2) is
  //  a cumulative of each value of each vector.
  // p => g(v1, v2) => v1[i] * v2[i]
  return (p: Vector) => (v1: Vector, v2: Vector) => {
    return v1.reduce((acc, val, i) => {
      return acc + val * v2[i];
    }, 0);
  };
}

// Helper for scalar derivatives
function directionalDerivativeScalar(
  f: ScalarField,
  dir: Vector,
  p: Vector
): number {
  const h = 1e-6;
  const pPlus = p.map((val, i) => val + dir[i] * h);
  const pMinus = p.map((val, i) => val - dir[i] * h);
  return (f(pPlus) - f(pMinus)) / (2 * h);
}

// Helper for vector derivatives
function directionalDerivative(
  f: (p: Vector) => Vector,
  dir: Vector,
  p: Vector,
  component: number
): number {
  const h = 1e-6;
  const pPlus = [...p];
  const pMinus = [...p];

  for (let i = 0; i < p.length; i++) {
    pPlus[i] += dir[i] * h;
    pMinus[i] -= dir[i] * h;
  }

  return (f(pPlus)[component] - f(pMinus)[component]) / (2 * h);
}

// Helper to compute (d / dx^k) g_ij at point p
const partialDeriv = (p: Vector, i: number, j: number, k: number): number => {
  const h = 1e-5; // Step size for differentiation

  // Create a point slightly shifted in the k-direction
  const pPlus = [...p];
  pPlus[k] += h;

  const pMinus = [...p];
  pMinus[k] -= h;

  // Get the metric components at the shifted points
  const g_ij_plus = getMetricComponent(pPlus, i, j);
  const g_ij_minus = getMetricComponent(pMinus, i, j);

  // Central difference formula: [f(x+h) - f(x-h)] / 2h
  return (g_ij_plus - g_ij_minus) / (2 * h);
};

// Helper for derivatives of differential forms
const exteriorDerivative0To1: ExteriorDerivativeField = (
  f: DifferentialForm0
): DifferentialForm1 => {
  return (v: Vector) => (u: Vector) => {
    // This is essentially the Gradient.
    return directionalDerivativeScalar(f, u, v);
  };
};

// Helper to getConnected
function covariantDerivative(
  vectorField: (p: Vector) => Vector,
  direction: Vector,
  p: Vector
): Vector {
  const n = p.length;
  const result = new Array(n).fill(0);

  for (let k = 0; k < n; k++) {
    // Standard directional derivative
    let partial = directionalDerivative(vectorField, direction, p, k);

    // Correction term: \Gamma^k_{ij} * V^i * dx^j
    let correction = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        correction +=
          christoffelSymbols(p, i, j, k) * vectorField(p)[i] * direction[j];
      }
    }
    result[k] = partial + correction;
  }
  return result;
}

// Helper for the Lie Derivative
function computeLieBracket(
  uField: (p: Vector) => Vector,
  vField: (p: Vector) => Vector,
  p: Vector
): Vector {
  const n = p.length;
  const result = new Array(n).fill(0);

  for (let k = 0; k < n; k++) {
    // 1. How much does the k-th component of V change along U?
    const u_del_v = directionalDerivative(vField, uField(p), p, k);

    // 2. How much does the k-th component of U change along V?
    const v_del_u = directionalDerivative(uField, vField(p), p, k);

    // 3. The bracket is the difference
    result[k] = u_del_v - v_del_u;
  }

  return result;
}

// Helper to extract a single scalar g_ij from the metric function
const getMetricComponent = (p: Vector, i: number, j: number): number => {
  const v_i = new Array(p.length).fill(0);
  v_i[i] = 1;
  const v_j = new Array(p.length).fill(0);
  v_j[j] = 1;
  return getEuclideanMetric(p)(p)(v_i, v_j);
};

// Helper to get the helper for the Laplace function
function calculateDeterminant(m: Vector[]): Scalar {
  if (m.length === 2) {
    return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  }
  // Standard Laplace expansion for 3D
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

// Helper to get connective (cofactor) scalars within a manifold.
function getCofactor(m: Vector[], row: number, col: number): Scalar {
  const subMatrix = m
    .filter((_, r) => r !== row)
    .map(r => r.filter((_, c) => c !== col));

  const sign = (row + col) % 2 === 0 ? 1 : -1;
  return sign * calculateDeterminant(subMatrix);
}

// Helper to get the inverse of a matrix
function invertMatrix(matrix: Vector[]): Vector[] {
  const n = matrix.length;
  const det = calculateDeterminant(matrix);

  // If det is 0, the manifold has a singularity (like the poles of a sphere in polar coords).
  if (Math.abs(det) < 1e-10) {
    throw new Error("Singular Metric: Coordinate system breakdown.");
  }

  const result: Vector[] = Array.from({ length: n }, () => new Array(n));

  if (n === 2) {
    // 2D Shortcut: Swap diagonals, negate off-diagonals, divide by det.
    result[0][0] = matrix[1][1] / det;
    result[0][1] = -matrix[0][1] / det;
    result[1][0] = -matrix[1][0] / det;
    result[1][1] = matrix[0][0] / det;
  } else {
    // 3D/ND: General cofactor expansion
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // Transpose the cofactor matrix to get the Adjugate
        result[j][i] = getCofactor(matrix, i, j) / det;
      }
    }
  }
  return result;
}

// === IMPLEMENTATION ===

// A field where vectors rotate around the origin (0,0)
const vortexField = (p: Vector): Vector => {
  const [x, y] = p;
  // Vector is perpendicular to the position vector (-y, x)
  // This creates a circular swirling motion
  return [-y, x];
};

// Now you can ask: "How does the wind change if I move North at point [1, 2]?"
const change = covariantDerivative(vortexField, [0, 1], [1, 2]);

/**
 * THE HODGE STAR OPERATOR (*)
 * This is the "duality" operator.
 * It converts a k-form into an (n-k)-form based on the Metric.
 * In Graphics: Rotates a flow field by 90 degrees on a surface.
 * In Physics: Relates the Electric field to the Magnetic field.
 */
const hodgeStar = (
  form: DifferentialForm1,
  metric: getMetric_T
): DifferentialForm1 => {
  // On a 2D surface, *dx = dy and *dy = -dx.
  // It depends entirely on the 'g' (metric) you defined earlier.
  return (p: Vector) => (v: Vector) => {
    const orthogonalV = rotate90(v, metric(p));
    return form(p)(orthogonalV);
  };
};

/**
 * THE LAPLACE-BELTRAMI OPERATOR (Δ)
 * The most important operator in Discrete Differential Geometry.
 * Δf = * d * d f (The Div of the Grad)
 */
const laplaceBeltrami = (
  f: DifferentialForm0,
  metric: getMetric_T,
  p: Vector
): DifferentialForm0 => {
  // This measures the "average value deviation" in curved space.
  // In your engine: Used for heat diffusion or finding the shortest path on a mesh.
  const df = exteriorDerivative0To1(f);
  const starDf = hodgeStar(df, metric);
  const star_starDf = hodgeStar(starDf, df);
  return star_starDf(p); // Resulting scalar field
};

/**
 * THE INVERSE METRIC
 * Required to "raise" indices and calculate the Christoffel symbols.
 */
const getInverseMetricMatrix = (p: Vector): number[][] => {
  const n = p.length;
  const metric = getEuclideanMetric(p); // This is our (p) => (v1, v2) => number

  // Construct the explicit matrix [g_ij] at point p
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v_i = new Array(n).fill(0);
      v_i[i] = 1;
      const v_j = new Array(n).fill(0);
      v_j[j] = 1;
      matrix[i][j] = metric(p)(v_i, v_j);
    }
  }

  // Perform Matrix Inversion (e.g., Gaussian elimination or Cramer's rule for 2x2/3x3)
  return invertMatrix(matrix);
};

/**
 * CHRISTOFFEL SYMBOLS (The Connection)
 * These describe how the basis vectors change as you move.
 * Mathematically: $\Gamma^k_{ij}$
 * Required for the Geodesic Equation (moving in a 'straight' line).
 */
const christoffelSymbols = (
  p: Vector,
  i: number,
  j: number,
  k: number
): number => {
  // In practice, these are partial derivatives of the Metric Tensor.
  // This function would calculate: 0.5 * sum
  // sum = g^{kl} * ((d_j * g_{il}) + (d_i * g_{jl}) - (d_l * g_{ij}))
  let sum = 0;
  const n = p.length;

  // 1. Get the inverse metric at point p
  const gInv = getInverseMetricMatrix(p);

  // 2. Compute the sum over l (Einstein Summation)
  for (let l = 0; l < n; l++) {
    // 3. Compute partial derivatives of the metric
    const dg_il_dj = partialDeriv(p, i, l, j); // d/dx^j of g_il
    const dg_jl_di = partialDeriv(p, j, l, i); // d/dx^i of g_jl
    const dg_ij_dl = partialDeriv(p, i, j, l); // d/dx^l of g_ij

    sum += gInv[k][l] * (dg_il_dj + dg_jl_di - dg_ij_dl);
  }

  return 0.5 * sum;
};

/**
 * GEODESIC FLOW (Physics/Navigation)
 * Solving the "straight line" equation on a manifold.
 * d²x/dt² + Γ(dx/dt, dx/dt) = 0
 */
function computeGeodesicStep(
  position: Vector,
  velocity: Vector,
  dt: number
): { nextPos: Vector; nextVel: Vector } {
  const n = position.length;
  const acceleration = new Array(n).fill(0);

  for (let k = 0; k < n; k++) {
    let gammaSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // Using the Christoffel symbols defined in the previous part
        gammaSum +=
          christoffelSymbols(position, i, j, k) * velocity[i] * velocity[j];
      }
    }
    acceleration[k] = -gammaSum;
  }

  // Symplectic Euler step (standard for physics engines)
  const nextVel = velocity.map((v, i) => v + acceleration[i] * dt);
  const nextPos = position.map((p, i) => p + nextVel[i] * dt);

  return { nextPos, nextVel };
}

/**
 * RIEMANN CURVATURE TENSOR
 * Measures the failure of the Covariant Derivative to commute.
 * If you transport a vector around a tiny loop and it changes, this tensor is non-zero.
 */
function getRiemannCurvature(p: Vector) {
  return (u: Vector, v: Vector, wF: (p: Vector) => Vector): Vector => {
    // R(u, v)w = \nabla_u \nabla_v w - \nabla_v \nabla_u w - \nabla_{[u,v]} w
    // This represents the fundamental "curviness" of the space.
    const gradV_W = (pos: Vector) => covariantDerivative(wF, v, pos);
    const gradU_W = (pos: Vector) => covariantDerivative(wF, u, pos);
    // gradient u of gradient w
    const term1 = covariantDerivative(gradV_W, u, p);
    // gradient v of gradient w
    const term2 = covariantDerivative(gradU_W, v, p);
    // movement directions
    const uField = (pos: Vector) => [1, 0]; // Unit vector in X
    const vField = (pos: Vector) => [0, 1]; // Unit vector in Y
    // passenger
    const bracketUV = computeLieBracket(uField, vField, p); // should be 0
    const term3 = covariantDerivative(wF, bracketUV, p);
    const result = term1.map((val, i) => val - term2[i] - term3[i]);
    return result;
  };
}

/**
 * In an SDF engine, the Laplacian measures how the surface 'curves'
 * away from the tangent plane.
 */
const computeSDFLaplacian = (sdf: (p: Vector) => number, p: Vector): number => {
  // This is the Divergence of the Normal Field: div(grad(f) / |grad(f)|)
  // In a shader, you'd use finite differences (6-tap or 12-tap)
  const epsilon = Number.EPSILON * 1e3;
  const dx =
    (sdf([p[0] + epsilon, p[1], p[2]]) -
      2 * sdf(p) +
      sdf([p[0] - epsilon, p[1], p[2]])) /
    (epsilon * epsilon);
  const dy =
    (sdf([p[0], p[1] + epsilon, p[2]]) -
      2 * sdf(p) +
      sdf([p[0], p[1] - epsilon, p[2]])) /
    (epsilon * epsilon);
  const dz =
    (sdf([p[0], p[1], p[2] + epsilon]) -
      2 * sdf(p) +
      sdf([p[0], p[1], p[2] - epsilon])) /
    (epsilon * epsilon);

  return dx + dy + dz;
};

/**
 * Spherical Metric: ds^2 = dθ^2 + sin^2(θ)dφ^2
 *  - θ,φ = polar coordinates;
 *    - θ = meridian;
 *    - φ = azimuth;
 *  - dθ^2 = always constant (e.g. 1), drawn as meridians:
 *    - rate of change is uniform;
 *    - any angle (θ) change is always the same distance covered for v1,v2;
 *    - 1deg south of equator is the same as 1deg south of northpole;
 *      - moving space towards the equator doesn't make more space;
 *      - it's more like a zoom in;
 *    - at angle (0,0), changing phi (0,1) would describe angular momentum;
 *      - planets are oversized particles.
 *    - changing theta (1,0) describes walking backwards.
 */
const getSphericalMetric: getCurve_T = (p: Vector) => {
  return (v1: Vector, v2: Vector) => {
    const [theta, phi] = p;
    const r = 1; // rate of change in euclidean space;
    const g_theta_sq = r ** 2;
    const g_phi_sq = r ** 2 * Math.sin(theta) ** 2;
    // g_theta_theta = 1, g_phi_phi = sin^2(theta)
    return g_theta_sq * v1[0] * v2[0] + g_phi_sq * v1[1] * v2[1];
  };
};
