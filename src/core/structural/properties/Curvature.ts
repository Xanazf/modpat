import type { GridIndex4D } from "@_lib/soa/GridIndex4D";
import { DOPAT_CONFIG } from "@config";
import { SlotType } from "@core_i/System";

/**
 * Scalar curvature computation for the 4D conformal metric.
 *
 * For metric g_ij = e^{2φ} δ_ij the Ricci scalar is:
 *   R = −6 e^{−2φ} (∇²φ + |∇φ|²)
 *
 * where φ(p) = Σ_j infl_j · exp(−|p − p_j|² / F) is the local semantic
 * density (same kernel used by getMetricForce in Traveler).
 *
 * All three quantities share a single O(n) pass over the neighbourhood:
 *   g_j    = infl_j · exp(−d²_j / F)
 *   φ      = Σ g_j
 *   ∇²φ    = Σ g_j · (−8/F + 4d²_j/F²)
 *   ∇φ     = (−2/F) · Σ g_j · (p − p_j)        [4D vector]
 *   |∇φ|²  = (4/F²) · |Σ g_j · (p − p_j)|²
 */
export function computeCurvature(
  system: Root.ManifoldView,
  gridIndex: GridIndex4D,
  px: number,
  py: number,
  pz: number,
  pw: number,
  boost?: Set<number>
): Property.CurvatureResult {
  const {
    INFLUENCE_RADIUS,
    INFLUENCE_FALLOFF: F,
    PHI_MAX,
    BODY_SLOT_ATTRACTION,
    COND_SLOT_ATTRACTION,
  } = DOPAT_CONFIG.PHYSICS;
  const actualRadius = Math.sqrt(INFLUENCE_RADIUS);
  const candidates = gridIndex.candidatesInRadius(px, py, pz, pw, actualRadius);

  let phi = 0;
  let nabla2phi = 0;
  let sx = 0,
    sy = 0,
    sz = 0,
    sw = 0;

  for (const j of candidates) {
    const dx = px - system.posX[j];
    const dy = py - system.posY[j];
    const dz = pz - system.posZ[j];
    const dw = pw - system.posW[j];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 >= INFLUENCE_RADIUS) continue;

    let infl_j = system.density[j] * 2.0 + system.intensity[j] * 1.5 + 5.0;
    if (boost?.has(system.scope[j])) infl_j += 50.0;
    const st = system.slotType[j];
    if (st & SlotType.Body) infl_j += BODY_SLOT_ATTRACTION;
    if (st & SlotType.Condition) infl_j += COND_SLOT_ATTRACTION;

    const g_j = infl_j * Math.exp(-d2 / F);

    phi += g_j;
    nabla2phi += g_j * (-8.0 / F + (4.0 * d2) / (F * F));
    sx += g_j * dx;
    sy += g_j * dy;
    sz += g_j * dz;
    sw += g_j * dw;
  }

  if (phi > PHI_MAX) phi = PHI_MAX;

  const gradPhiSq = (4.0 / (F * F)) * (sx * sx + sy * sy + sz * sz + sw * sw);
  const R = -6.0 * Math.exp(-2.0 * phi) * (nabla2phi + gradPhiSq);

  return { phi, nabla2phi, gradPhiSq, R };
}

/** Scalar curvature R at an arbitrary point p. */
export function scalarCurvature(
  system: Root.ManifoldView,
  gridIndex: GridIndex4D,
  px: number,
  py: number,
  pz: number,
  pw: number,
  boost?: Set<number>
): number {
  return computeCurvature(system, gridIndex, px, py, pz, pw, boost).R;
}

/** Scalar curvature R evaluated at atom id's position. */
export function atomCurvature(
  id: number,
  system: Root.ManifoldView,
  gridIndex: GridIndex4D,
  boost?: Set<number>
): number {
  return scalarCurvature(
    system,
    gridIndex,
    system.posX[id],
    system.posY[id],
    system.posZ[id],
    system.posW[id],
    boost
  );
}

/**
 * WGSL twin of computeCurvature for shader use.
 *
 * Assumes the caller provides the same sysPos / sysInfluence bindings and
 * Params struct already present in the geodesic pipeline.  Insert this
 * snippet into the shader source before any usage.
 */
export const CURVATURE_WGSL = `
struct CurvatureResult { phi: f32, nabla2phi: f32, gradPhiSq: f32, R: f32 }

fn computeCurvatureAt(p: vec4<f32>) -> CurvatureResult {
    let F = params.iF;
    var phi = 0.0;
    var lap = 0.0;
    var sx = 0.0; var sy = 0.0; var sz = 0.0; var sw = 0.0;
    for (var j = 0u; j < params.sysLength; j = j + 1u) {
        let diff = p - sysPos[j];
        let d2 = dot(diff, diff);
        if (d2 >= params.iR) { continue; }
        let g_j = sysInfluence[j] * exp(-d2 / F);
        phi  = phi + g_j;
        lap  = lap + g_j * (-8.0 / F + 4.0 * d2 / (F * F));
        sx   = sx + g_j * diff.x;
        sy   = sy + g_j * diff.y;
        sz   = sz + g_j * diff.z;
        sw   = sw + g_j * diff.w;
    }
    phi = min(phi, params.phiMax);
    let gps = (4.0 / (F * F)) * (sx*sx + sy*sy + sz*sz + sw*sw);
    let R   = -6.0 * exp(-2.0 * phi) * (lap + gps);
    return CurvatureResult(phi, lap, gps, R);
}
` as const;
