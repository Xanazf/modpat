/**
 * Locomotion – geodesic traversal as a plain function module.
 *
 * All functions take system, unfolder, and the mutable LocomotionState
 * explicitly. No class instantiation required.
 */

import { DOPAT_CONFIG } from "@config";
import { SlotType } from "@core_i/System";
import {
  computeHolonomy as computeHolonomyMath,
  computeChristoffelForce,
  updateChristoffels,
  regularizeChristoffels as regularizeChristoffelsMath,
  windingNumber2D,
  distance4DPoints,
  gpu_math,
} from "@core_s/Math";
import { metrics } from "@core_s/Metrics";
import { GridIndex4D } from "@mutate/GridIndex4D";
import type Unfolder from "@mutate/Unfolder";
import { CURVATURE_WGSL } from "@props/Curvature";
import nlp from "compromise";

// -- State & deps -----------------------------------------------------------

/** All mutable locomotion state owned by the Traveler. Create with makeLocomotionState(). */
export interface LocomotionState {
  gpu: PMath.Engine | null;
  geodesicPipeline: GPUComputePipeline | null;
  readonly gridIndex: GridIndex4D;
  readonly lastHolonomy: Float64Array; // 4×4 – updated each traverse
  lastInferentialEffort: number;
  readonly deltaGamma: Float64Array; // 64 floats – C4 Christoffel corrections
  phiClippedCount: number;
  _lastPathVelocity: [number, number, number, number];
  // -- getMetricForce scratch (reused across calls; no per-call allocation) --
  _candScratch: number[]; // candidate ids from the grid query
  _mfInfl: Float64Array; // per-surviving-candidate base influence
  _mfExp: Float64Array; // per-surviving-candidate exp(-d²/F) (the shared, costly term)
  _mfDx: Float64Array;
  _mfDy: Float64Array;
  _mfDz: Float64Array;
  _mfDw: Float64Array;
  // -- relaxPath per-point candidate cache (exact: keyed by integer cell coords) --
  _pcCands: number[][]; // one reused candidate-id list per path point
  _pcCellX: Int32Array; // last queried cell coords per point (cache key)
  _pcCellY: Int32Array;
  _pcCellZ: Int32Array;
  _pcCellW: Int32Array;
}

/** Grow the per-candidate scratch caches to hold at least `n` survivors. */
function ensureMetricForceCapacity(state: LocomotionState, n: number): void {
  if (state._mfInfl.length >= n) return;
  const cap = Math.max(n, state._mfInfl.length * 2, 64);
  state._mfInfl = new Float64Array(cap);
  state._mfExp = new Float64Array(cap);
  state._mfDx = new Float64Array(cap);
  state._mfDy = new Float64Array(cap);
  state._mfDz = new Float64Array(cap);
  state._mfDw = new Float64Array(cap);
}

const CELL_SENTINEL = 0x7fffffff;

/** Grow + invalidate the per-point candidate cache for a path of `steps` segments. */
function resetPathCandCache(state: LocomotionState, steps: number): void {
  const n = steps + 1;
  if (state._pcCellX.length < n) {
    state._pcCellX = new Int32Array(n);
    state._pcCellY = new Int32Array(n);
    state._pcCellZ = new Int32Array(n);
    state._pcCellW = new Int32Array(n);
    const cands: number[][] = state._pcCands;
    while (cands.length < n) cands.push([]);
  }
  state._pcCellX.fill(CELL_SENTINEL, 0, n); // invalidate every point's cache
}

export function makeLocomotionState(): LocomotionState {
  const lastHolonomy = new Float64Array(16);
  lastHolonomy[0] = lastHolonomy[5] = lastHolonomy[10] = lastHolonomy[15] = 1; // identity
  return {
    gpu: null,
    geodesicPipeline: null,
    gridIndex: new GridIndex4D(),
    lastHolonomy,
    lastInferentialEffort: 0,
    deltaGamma: new Float64Array(64),
    phiClippedCount: 0,
    _lastPathVelocity: [0, 0, 0, 0],
    _candScratch: [],
    _mfInfl: new Float64Array(64),
    _mfExp: new Float64Array(64),
    _mfDx: new Float64Array(64),
    _mfDy: new Float64Array(64),
    _mfDz: new Float64Array(64),
    _mfDw: new Float64Array(64),
    _pcCands: [],
    _pcCellX: new Int32Array(0),
    _pcCellY: new Int32Array(0),
    _pcCellZ: new Int32Array(0),
    _pcCellW: new Int32Array(0),
  };
}

// -- Grid index -------------------------------------------------------------

export function buildGridIndex(
  system: Root.ManifoldView,
  state: LocomotionState
): void {
  state.gridIndex.buildFromSystem(system);
}

// -- Metric force -----------------------------------------------------------

export function getMetricForce(
  px: number,
  py: number,
  pz: number,
  pw: number,
  pens: any[],
  boost: Set<number> | undefined,
  activeAtoms: Set<number> | undefined,
  system: Root.ManifoldView,
  state: LocomotionState
): [V: number, fx: number, fy: number, fz: number, fw: number] {
  const candidates = state._candScratch;
  state.gridIndex.candidatesInRadiusInto(
    px,
    py,
    pz,
    pw,
    Math.sqrt(DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS),
    candidates
  );
  return forceFromCandidates(
    candidates,
    px,
    py,
    pz,
    pw,
    pens,
    boost,
    activeAtoms,
    system,
    state
  );
}

/**
 * Core metric-force computation over an already-gathered candidate-id list.
 * Split out from getMetricForce so relaxPath can supply a candidate list cached
 * per path point (recomputed only when the point crosses a grid cell), avoiding
 * a fresh 81-cell grid walk on every relaxation iteration. Numerically identical
 * to the inline query path.
 */
function forceFromCandidates(
  candidates: number[],
  px: number,
  py: number,
  pz: number,
  pw: number,
  pens: any[],
  boost: Set<number> | undefined,
  activeAtoms: Set<number> | undefined,
  system: Root.ManifoldView,
  state: LocomotionState
): [V: number, fx: number, fy: number, fz: number, fw: number] {
  const phys = DOPAT_CONFIG.PHYSICS,
    F = phys.INFLUENCE_FALLOFF;
  let V = 1.0,
    fx = 0.0,
    fy = 0.0,
    fz = 0.0,
    fw = 0.0;
  ensureMetricForceCapacity(state, candidates.length);
  const mfInfl = state._mfInfl,
    mfExp = state._mfExp,
    mfDx = state._mfDx,
    mfDy = state._mfDy,
    mfDz = state._mfDz,
    mfDw = state._mfDw;

  // First pass: compute φ(p) over surviving candidates, caching the per-atom
  // base influence and the shared exp(-d²/F) so the force pass needn't recompute
  // the spatial filter, the influence sum, or the costly exponential.
  let phi = 0.0;
  let m = 0;
  for (let c = 0; c < candidates.length; c++) {
    const j = candidates[c];
    if (activeAtoms !== undefined && !activeAtoms.has(j)) continue;
    const dx = px - system.posX[j],
      dy = py - system.posY[j],
      dz = pz - system.posZ[j],
      dw = pw - system.posW[j];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 >= phys.INFLUENCE_RADIUS) continue;
    let infl = system.density[j] * 2.0 + system.intensity[j] * 1.5 + 5.0;
    if (boost?.has(system.scope[j])) infl += 50.0;
    const st = system.slotType[j];
    if (st & SlotType.Body) infl += phys.BODY_SLOT_ATTRACTION;
    if (st & SlotType.Condition) infl += phys.COND_SLOT_ATTRACTION;
    const ek = Math.exp(-d2 / F);
    phi += infl * ek;
    mfInfl[m] = infl;
    mfExp[m] = ek;
    mfDx[m] = dx;
    mfDy[m] = dy;
    mfDz[m] = dz;
    mfDw[m] = dw;
    m++;
  }
  if (phi > phys.PHI_MAX) {
    state.phiClippedCount++;
    phi = phys.PHI_MAX;
  }

  // Second pass: V and force, reusing the cached survivors.
  const conformal = phys.CONFORMAL_ENABLED ? Math.exp(-2.0 * phi) : 1.0;
  for (let k = 0; k < m; k++) {
    const dx = mfDx[k],
      dy = mfDy[k],
      dz = mfDz[k],
      dw = mfDw[k];
    let infl = mfInfl[k];
    infl *= Math.exp(-phys.PHI_TEMPORAL_DECAY * Math.max(0, dw));
    if (phys.CONFORMAL_ENABLED) infl *= conformal;
    const e = infl * mfExp[k];
    V -= e;
    const f = (2.0 * e) / F;
    fx += f * dx;
    fy += f * dy;
    fz += f * dz;
    fw += f * dw;
  }
  if (pens) {
    const Fp = phys.PENALTY_FALLOFF;
    for (const p of pens) {
      const dx = px - p.x,
        dy = py - p.y,
        dz = pz - p.z,
        dw = pw - p.w;
      const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
      if (d2 >= phys.PENALTY_RADIUS) continue;
      const e = p.strength * Math.exp(-d2 / Fp);
      V += e;
      const f = (-2.0 * e) / Fp;
      fx += f * dx;
      fy += f * dy;
      fz += f * dz;
      fw += f * dw;
    }
  }
  if (phys.A_B_FULL_GRADIENT && phys.CONFORMAL_ENABLED) {
    const V_sum = 1.0 - Math.max(0.01, V);
    let gpx = 0,
      gpy = 0,
      gpz = 0,
      gpw = 0;
    for (const j of candidates) {
      const dx = px - system.posX[j],
        dy = py - system.posY[j],
        dz = pz - system.posZ[j],
        dw = pw - system.posW[j];
      const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
      if (d2 >= phys.INFLUENCE_RADIUS) continue;
      let infl = system.density[j] * 2 + system.intensity[j] * 1.5 + 5;
      if (boost?.has(system.scope[j])) infl += 50;
      const st = system.slotType[j];
      if (st & SlotType.Body) infl += phys.BODY_SLOT_ATTRACTION;
      if (st & SlotType.Condition) infl += phys.COND_SLOT_ATTRACTION;
      const gk = infl * Math.exp(-d2 / F) * (-2 / F);
      gpx += gk * dx;
      gpy += gk * dy;
      gpz += gk * dz;
      gpw += gk * dw;
    }
    fx += 2 * V_sum * gpx;
    fy += 2 * V_sum * gpy;
    fz += 2 * V_sum * gpz;
    fw += 2 * V_sum * gpw;
  }
  return [Math.max(0.01, V), fx, fy, fz, fw];
}

export function getMetricForceWithInnerDerivative(
  px: number,
  py: number,
  pz: number,
  pw: number,
  pens: any[],
  boost: Set<number> | undefined,
  activeAtoms: Set<number> | undefined,
  system: Root.ManifoldView,
  state: LocomotionState
): [V: number, fx: number, fy: number, fz: number, fw: number] {
  const phys = DOPAT_CONFIG.PHYSICS;
  const oldGradient = phys.A_B_FULL_GRADIENT,
    oldConformal = phys.CONFORMAL_ENABLED;
  (phys as any).A_B_FULL_GRADIENT = true;
  (phys as any).CONFORMAL_ENABLED = true;
  try {
    return getMetricForce(
      px,
      py,
      pz,
      pw,
      pens,
      boost,
      activeAtoms,
      system,
      state
    );
  } finally {
    (phys as any).A_B_FULL_GRADIENT = oldGradient;
    (phys as any).CONFORMAL_ENABLED = oldConformal;
  }
}

// -- CPU path relaxation ----------------------------------------------------

export function relaxPath(
  px: Float64Array,
  py: Float64Array,
  pe: Float64Array,
  pa: Float64Array,
  steps: number,
  maxIterations: number,
  lr: number,
  boost: Set<number> | undefined,
  penalties: any[],
  activeAtoms: Set<number> | undefined,
  system: Root.ManifoldView,
  state: LocomotionState
): void {
  const v = new Float64Array(4);
  const cf = new Float64Array(4);
  // Per-point candidate cache: a path point moves by tiny lr steps each
  // iteration and rarely crosses a grid cell (cellSize ≫ step), so its 81-cell
  // candidate block is usually unchanged. Re-walk the grid only on a cell cross.
  resetPathCandCache(state, steps);
  const cs = state.gridIndex.cellSizeValue;
  const radius = Math.sqrt(DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS);
  const pcX = state._pcCellX,
    pcY = state._pcCellY,
    pcZ = state._pcCellZ,
    pcW = state._pcCellW,
    pcCands = state._pcCands;
  for (let iter = 0; iter < maxIterations; iter++) {
    for (let i = 1; i < steps; i++) {
      const cx = Math.floor(px[i] / cs) | 0,
        cy = Math.floor(py[i] / cs) | 0,
        cz = Math.floor(pe[i] / cs) | 0,
        cw = Math.floor(pa[i] / cs) | 0;
      const cands = pcCands[i];
      if (cx !== pcX[i] || cy !== pcY[i] || cz !== pcZ[i] || cw !== pcW[i]) {
        state.gridIndex.candidatesInRadiusInto(
          px[i],
          py[i],
          pe[i],
          pa[i],
          radius,
          cands
        );
        pcX[i] = cx;
        pcY[i] = cy;
        pcZ[i] = cz;
        pcW[i] = cw;
      }
      const [, fx, fy, fz, fw] = forceFromCandidates(
        cands,
        px[i],
        py[i],
        pe[i],
        pa[i],
        penalties,
        boost,
        activeAtoms,
        system,
        state
      );
      const sx = (px[i - 1] + px[i + 1]) / 2 - px[i],
        sy = (py[i - 1] + py[i + 1]) / 2 - py[i];
      const se = (pe[i - 1] + pe[i + 1]) / 2 - pe[i],
        sa = (pa[i - 1] + pa[i + 1]) / 2 - pa[i];

      v[0] = px[i] - px[i - 1];
      v[1] = py[i] - py[i - 1];
      v[2] = pe[i] - pe[i - 1];
      v[3] = pa[i] - pa[i - 1];
      computeChristoffelForce(v, state.deltaGamma, cf);
      const cfx = cf[0],
        cfy = cf[1],
        cfz = cf[2],
        cfw = cf[3];

      px[i] += lr * (sx * 2 - fx - cfx);
      py[i] += lr * (sy * 2 - fy - cfy);
      pe[i] += lr * (se * 2 - fz - cfz);
      const da = lr * (sa * 2 - fw - cfw);
      pa[i] += da;
      if (pa[i] - pa[i - 1] < 0) pa[i] -= (pa[i] - pa[i - 1]) * 0.9;
      if (i < steps && pa[i + 1] - pa[i] < 0)
        pa[i] += (pa[i + 1] - pa[i]) * 0.9;
    }
  }
  let tvx = 0,
    tvy = 0,
    tvz = 0,
    tvw = 0;
  for (let i = 1; i <= steps; i++) {
    tvx += px[i] - px[i - 1];
    tvy += py[i] - py[i - 1];
    tvz += pe[i] - pe[i - 1];
    tvw += pa[i] - pa[i - 1];
  }
  const vMag = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz + tvw * tvw) + 1e-12;
  state._lastPathVelocity = [tvx / vMag, tvy / vMag, tvz / vMag, tvw / vMag];
}

// -- GPU path relaxation ----------------------------------------------------

export async function relaxPathGPU(
  px: Float64Array,
  py: Float64Array,
  pe: Float64Array,
  pa: Float64Array,
  steps: number,
  maxIterations: number,
  learningRate: number,
  boostScopes: Set<number> | undefined,
  penalties: any[],
  system: Root.ManifoldView,
  state: LocomotionState
): Promise<void> {
  if (!state.geodesicPipeline) await _initGPUPipeline(state);
  const device = await gpu_math.getDevice();
  const sysLength = system.length;
  const sysInfluence = new Float32Array(sysLength),
    sysSlotType = new Uint32Array(sysLength);
  for (let j = 0; j < sysLength; j++) {
    let infl = system.density[j] * 2 + system.intensity[j] * 1.5 + 5;
    if (boostScopes?.has(system.scope[j])) infl += 50;
    sysInfluence[j] = infl;
    sysSlotType[j] = system.slotType[j];
  }
  const penaltyData = new Float32Array(Math.max(1, penalties.length) * 8);
  penalties.forEach((p, i) => {
    penaltyData[i * 8] = p.x;
    penaltyData[i * 8 + 1] = p.y;
    penaltyData[i * 8 + 2] = p.z;
    penaltyData[i * 8 + 3] = p.w;
    penaltyData[i * 8 + 4] = p.strength;
  });
  const pathData = new Float32Array((steps + 1) * 4);
  for (let i = 0; i <= steps; i++) {
    pathData[i * 4] = px[i];
    pathData[i * 4 + 1] = py[i];
    pathData[i * 4 + 2] = pe[i];
    pathData[i * 4 + 3] = pa[i];
  }
  const sysPosData = new Float32Array(sysLength * 4);
  for (let j = 0; j < sysLength; j++) {
    sysPosData[j * 4] = system.posX[j];
    sysPosData[j * 4 + 1] = system.posY[j];
    sysPosData[j * 4 + 2] = system.posZ[j];
    sysPosData[j * 4 + 3] = system.posW[j];
  }
  const cb = (data: any, size: number, usage: number) => {
    const b = device.createBuffer({ size, usage });
    if (data) device.queue.writeBuffer(b, 0, data);
    return b;
  };
  const bPath = cb(
    pathData,
    pathData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  );
  const bSysPos = cb(
    sysPosData,
    sysPosData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const bSysInfl = cb(
    sysInfluence,
    sysInfluence.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const bSysST = cb(
    sysSlotType,
    sysSlotType.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const bPen = cb(
    penaltyData,
    penaltyData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const phys = DOPAT_CONFIG.PHYSICS,
    params = new ArrayBuffer(64),
    v = new DataView(params);
  v.setUint32(0, steps, true);
  v.setUint32(4, sysLength, true);
  v.setFloat32(8, learningRate, true);
  v.setUint32(12, penalties.length, true);
  v.setUint32(16, maxIterations, true);
  v.setFloat32(20, phys.GRADIENT_STEP, true);
  v.setFloat32(24, phys.INFLUENCE_RADIUS, true);
  v.setFloat32(28, phys.INFLUENCE_FALLOFF, true);
  v.setFloat32(32, phys.PENALTY_RADIUS, true);
  v.setFloat32(36, phys.PENALTY_FALLOFF, true);
  v.setFloat32(40, phys.BODY_SLOT_ATTRACTION, true);
  v.setFloat32(44, phys.COND_SLOT_ATTRACTION, true);
  v.setFloat32(48, phys.PHI_TEMPORAL_DECAY, true);
  v.setUint32(52, phys.CONFORMAL_ENABLED ? 1 : 0, true);
  v.setFloat32(56, phys.PHI_MAX, true);
  const bParams = cb(
    params,
    64,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  );
  const bRead = cb(
    undefined,
    pathData.byteLength,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  );
  const bg = device.createBindGroup({
    layout: state.geodesicPipeline!.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bPath } },
      { binding: 1, resource: { buffer: bSysPos } },
      { binding: 2, resource: { buffer: bSysInfl } },
      { binding: 3, resource: { buffer: bPen } },
      { binding: 4, resource: { buffer: bParams } },
      { binding: 5, resource: { buffer: bSysST } },
    ],
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(state.geodesicPipeline!);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(1);
  pass.end();
  enc.copyBufferToBuffer(bPath, 0, bRead, 0, pathData.byteLength);
  device.queue.submit([enc.finish()]);
  await bRead.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(bRead.getMappedRange().slice(0));
  bRead.unmap();
  for (let i = 0; i <= steps; i++) {
    px[i] = res[i * 4];
    py[i] = res[i * 4 + 1];
    pe[i] = res[i * 4 + 2];
    pa[i] = res[i * 4 + 3];
  }
  [bPath, bSysPos, bSysInfl, bSysST, bPen, bParams, bRead].forEach(b =>
    b.destroy()
  );
}

async function _initGPUPipeline(state: LocomotionState): Promise<void> {
  const device = await gpu_math.getDevice();
  const shader = device.createShaderModule({
    code: `
    @group(0) @binding(0) var<storage, read_write> pathData: array<vec4<f32>>;
    @group(0) @binding(1) var<storage, read> sysPos: array<vec4<f32>>;
    @group(0) @binding(2) var<storage, read> sysInfluence: array<f32>;
    struct Penalty { pos: vec4<f32>, strength: f32, _p1: f32, _p2: f32, _p3: f32 };
    @group(0) @binding(3) var<storage, read> penalties: array<Penalty>;
    struct Params { steps: u32, sysLength: u32, lr: f32, penCount: u32, iter: u32, h: f32, iR: f32, iF: f32, pR: f32, pF: f32, bodyAttr: f32, condAttr: f32, temporalDecay: f32, conformalEnabled: u32, phiMax: f32, _pad: u32 };
    @group(0) @binding(4) var<uniform> params: Params;
    @group(0) @binding(5) var<storage, read> sysSlotType: array<u32>;
    ${CURVATURE_WGSL}
    const SLOT_BODY: u32 = 2u; const SLOT_CONDITION: u32 = 4u;
    struct MFR { V: f32, fx: f32, fy: f32, fz: f32, fw: f32 };
    fn mfAt(p: vec4<f32>) -> MFR {
      var V=1.0; var fx=0.0; var fy=0.0; var fz=0.0; var fw=0.0; let F=params.iF;
      var phi=0.0;
      for (var j=0u;j<params.sysLength;j=j+1u) {
        let d=p-sysPos[j]; let dSq=dot(d,d); if(dSq>=params.iR){continue;}
        phi=phi+sysInfluence[j]*exp(-dSq/F);
      }
      phi=min(phi,params.phiMax);
      for (var j=0u;j<params.sysLength;j=j+1u) {
        let d=p-sysPos[j]; let dSq=dot(d,d); if(dSq>=params.iR){continue;}
        var infl=sysInfluence[j]; let st=sysSlotType[j];
        if((st&SLOT_BODY)!=0u){infl=infl+params.bodyAttr;}
        if((st&SLOT_CONDITION)!=0u){infl=infl+params.condAttr;}
        infl=infl*exp(-params.temporalDecay*max(0.0,p.w-sysPos[j].w));
        if(params.conformalEnabled!=0u){infl=infl*exp(-2.0*phi);}
        let e=infl*exp(-dSq/F); V=V-e; let f=2.0*e/F;
        fx=fx+f*d.x; fy=fy+f*d.y; fz=fz+f*d.z; fw=fw+f*d.w;
      }
      for (var k=0u;k<params.penCount;k=k+1u) {
        let d=p-penalties[k].pos; let dSq=dot(d,d); if(dSq>=params.pR){continue;}
        let e=penalties[k].strength*exp(-dSq/params.pF); V=V+e; let f=-2.0*e/params.pF;
        fx=fx+f*d.x; fy=fy+f*d.y; fz=fz+f*d.z; fw=fw+f*d.w;
      }
      V=max(0.01,V); return MFR(V,fx,fy,fz,fw);
    }
    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let i=id.x;
      for (var it=0u;it<params.iter;it=it+1u) {
        if(i>0u&&i<params.steps) {
          let curr=pathData[i]; let gr=mfAt(curr);
          let force=vec4<f32>(gr.fx,gr.fy,gr.fz,gr.fw);
          let spring=(pathData[i-1u]+pathData[i+1u])/2.0-curr;
          var next=curr+params.lr*(spring*2.0-force);
          let ageDiff=next.w-pathData[i-1u].w;
          if(ageDiff<0.0){next.w=next.w-ageDiff*0.9;}
          pathData[i]=next;
        }
        storageBarrier();
      }
    }
  `,
  });
  state.geodesicPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: shader, entryPoint: "main" },
  });
}

// -- C4: Christoffel corrections --------------------------------------------

function _updateChristoffels(scale: number, state: LocomotionState): void {
  const delta = DOPAT_CONFIG.PHYSICS.CHRISTOFFEL_LR * scale;
  updateChristoffels(state._lastPathVelocity, delta, state.deltaGamma);
}

export function regularizeChristoffels(state: LocomotionState): void {
  regularizeChristoffelsMath(
    state.deltaGamma,
    DOPAT_CONFIG.PHYSICS.CHRISTOFFEL_REGULARIZATION
  );
}

// -- D2: Holonomy -----------------------------------------------------------

export function computeHolonomy(
  px: Float64Array,
  py: Float64Array,
  pe: Float64Array,
  pa: Float64Array,
  steps: number,
  state: LocomotionState
): void {
  state.lastInferentialEffort = computeHolonomyMath(
    px,
    py,
    pe,
    pa,
    steps,
    state.lastHolonomy
  );
}

// -- D3: Homotopy -----------------------------------------------------------

export function detectHomotopy(
  pathA: Uint32Array,
  pathB: Uint32Array,
  h1Bars: Topology.PersistenceBar[],
  minPersistence: number,
  system: Root.ManifoldView
): Mapping.HomotopyResult {
  if (h1Bars.length === 0)
    return { homotopic: true, straddledH1Bars: [], analogyScore: 0 };
  const loop: [number, number][] = [];
  for (const id of pathA)
    if (id < system.length && system.isAllocated(id))
      loop.push([system.posX[id], system.posY[id]]);
  for (let i = pathB.length - 1; i >= 0; i--) {
    const id = pathB[i];
    if (id < system.length && system.isAllocated(id))
      loop.push([system.posX[id], system.posY[id]]);
  }
  if (loop.length < 3)
    return { homotopic: true, straddledH1Bars: [], analogyScore: 0 };
  const qualified = h1Bars.filter(b => b.death - b.birth > minPersistence);
  const straddled: Topology.PersistenceBar[] = [];
  for (const bar of qualified) {
    const id = bar.generatorAtomId;
    if (!system.isAllocated(id)) continue;
    if (windingNumber2D(loop, system.posX[id], system.posY[id]) !== 0)
      straddled.push(bar);
  }
  return {
    homotopic: straddled.length === 0,
    straddledH1Bars: straddled,
    analogyScore:
      qualified.length > 0 ? straddled.length / qualified.length : 0,
  };
}

// -- Path helpers -----------------------------------------------------------

export function reinforcePath(
  path: Uint32Array,
  system: Root.ManifoldView
): void {
  const FACTOR = 1.05,
    CAP = system.c * 20;
  for (let i = 1; i < path.length - 1; i++) {
    const id = path[i];
    if (!system.isAllocated(id)) continue;
    if (system.operatorClass[id] !== 0) continue;
    const m = system.mass[id];
    if (m <= 0) continue;
    system.mass[id] = Math.min(m * FACTOR, CAP);
    system.update(id, "reinforce");
  }
}

function _getPotentialAndNearest(
  x: number,
  y: number,
  z: number,
  w: number,
  pens: any[],
  boost: Set<number> | undefined,
  activeAtoms: Set<number> | undefined,
  system: Root.ManifoldView,
  state: LocomotionState
): { potential: number; nearestId: number } {
  const nearRadius = Math.sqrt(DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS) * 4;
  const nearestId = state.gridIndex.nearest(
    x,
    y,
    z,
    w,
    nearRadius,
    system,
    activeAtoms
  );
  const [potential] = getMetricForce(
    x,
    y,
    z,
    w,
    pens,
    boost,
    activeAtoms,
    system,
    state
  );
  return { potential, nearestId };
}

function _review(
  px: Float64Array,
  py: Float64Array,
  pe: Float64Array,
  pa: Float64Array,
  steps: number,
  activeAtoms: Set<number> | undefined,
  system: Root.ManifoldView,
  state: LocomotionState
): Mapping.ReviewReport {
  const phys = DOPAT_CONFIG.PHYSICS,
    trapR = Math.sqrt(phys.TRAP_DISTANCE_THRESHOLD);
  for (let i = 1; i < steps; i++) {
    const nId = state.gridIndex.nearest(
      px[i],
      py[i],
      pe[i],
      pa[i],
      trapR,
      system,
      activeAtoms
    );
    if (nId === -1) continue;
    const ddx = px[i] - system.posX[nId],
      ddy = py[i] - system.posY[nId],
      ddz = pe[i] - system.posZ[nId],
      ddw = pa[i] - system.posW[nId];
    const dSq = ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw;
    if (
      dSq < phys.TRAP_DISTANCE_THRESHOLD &&
      system.density[nId] > phys.TRAP_MASS_THRESHOLD &&
      system.entropyRate[nId] < phys.TRAP_ENTROPY_THRESHOLD
    )
      return { passed: false, reason: "Logic Trap detected", trapIndex: i };
  }
  return { passed: true };
}

function _extractIds(
  px: Float64Array,
  py: Float64Array,
  pe: Float64Array,
  pa: Float64Array,
  steps: number,
  preExpandLength: number,
  targetId: number,
  system: Root.ManifoldView,
  state: LocomotionState
): Uint32Array {
  const resultIds: number[] = [],
    maxPosYByLayer = new Map<number, number>();
  let fallbackCount = 0;
  for (let i = 0; i <= steps; i++) {
    let bestId = -1,
      minDiff = Infinity;
    const loopStart = preExpandLength > 0 ? preExpandLength : 0;
    const evalJ = (j: number) => {
      const dx = system.posX[j] - px[i],
        dy = system.posY[j] - py[i],
        dz = system.posZ[j] - pe[i],
        dw = system.posW[j] - pa[i];
      const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
      let tot = distSq + dw * dw * 1e6;
      const layJ = Math.floor(
        system.posZ[j] / DOPAT_CONFIG.structural.LAYER_BUCKET_SIZE
      );
      if (system.posY[j] < (maxPosYByLayer.get(layJ) ?? -Infinity)) tot += 1e6;
      if (
        tot < minDiff &&
        !(
          system.density[j] > DOPAT_CONFIG.PHYSICS.TRAP_MASS_THRESHOLD &&
          system.entropyRate[j] < DOPAT_CONFIG.PHYSICS.TRAP_ENTROPY_THRESHOLD
        )
      ) {
        minDiff = tot;
        bestId = j;
      }
    };

    const sortedW = state.gridIndex.getSortedW();
    const sortedIdsByW = state.gridIndex.getSortedIdsByW();
    const count = sortedW.length;

    if (count === 0) {
      for (let j = loopStart; j < system.length; j++) evalJ(j);
    } else {
      // Binary search to find starting index in sortedW
      let low = 0;
      let high = count - 1;
      let idx = 0;
      const targetW = pa[i];
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (sortedW[mid] < targetW) {
          low = mid + 1;
          idx = mid;
        } else {
          high = mid - 1;
        }
      }

      // Scan outwards
      let left = idx;
      let right = idx + 1;
      while (left >= 0 || right < count) {
        let checkLeft = left >= 0;
        let checkRight = right < count;

        if (checkLeft) {
          const dw = targetW - sortedW[left];
          if (dw * dw * 1000000 >= minDiff) {
            left = -1;
            checkLeft = false;
          }
        }
        if (checkRight) {
          const dw = sortedW[right] - targetW;
          if (dw * dw * 1000000 >= minDiff) {
            right = count;
            checkRight = false;
          }
        }

        if (!checkLeft && !checkRight) {
          break;
        }

        if (checkLeft) {
          const id = sortedIdsByW[left];
          if (id >= loopStart) evalJ(id);
          left--;
        }
        if (checkRight) {
          const id = sortedIdsByW[right];
          if (id >= loopStart) evalJ(id);
          right++;
        }
      }
    }

    if (targetId >= 0 && targetId < loopStart) evalJ(targetId);
    if (
      bestId !== -1 &&
      (resultIds.length === 0 || resultIds[resultIds.length - 1] !== bestId)
    ) {
      const layB = Math.floor(
        system.posZ[bestId] / DOPAT_CONFIG.structural.LAYER_BUCKET_SIZE
      );
      if (resultIds.length > 0) {
        const lastId = resultIds[resultIds.length - 1],
          layL = Math.floor(
            system.posZ[lastId] / DOPAT_CONFIG.structural.LAYER_BUCKET_SIZE
          );
        if (
          layL === layB &&
          bestId > lastId &&
          bestId - lastId < DOPAT_CONFIG.mapper.PATH_GAP_FILL_MAX
        )
          for (let f = lastId + 1; f < bestId; f++) resultIds.push(f);
      }
      resultIds.push(bestId);
      const cur = maxPosYByLayer.get(layB) ?? -Infinity;
      if (system.posY[bestId] > cur)
        maxPosYByLayer.set(layB, system.posY[bestId]);
    }
  }
  return new Uint32Array(resultIds);
}

// -- Main traversal ---------------------------------------------------------

export async function travel(
  sourceId: number,
  targetId: number,
  options: Mapping.RouteOptions,
  unfolder: Unfolder | null,
  system: Root.ManifoldView,
  state: LocomotionState
): Promise<Uint32Array> {
  const steps = options.steps ?? 32,
    boostScopes = options.boostScopes,
    lr = options.learningRate ?? 0.05;
  const maxIter = options.maxIterations ?? 100,
    activeAtoms = options.activeAtoms;
  const px = new Float64Array(steps + 1),
    py = new Float64Array(steps + 1);
  const pe = new Float64Array(steps + 1),
    pa = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    px[i] =
      system.posX[sourceId] +
      t * (system.posX[targetId] - system.posX[sourceId]);
    py[i] =
      system.posY[sourceId] +
      t * (system.posY[targetId] - system.posY[sourceId]);
    pe[i] =
      system.posZ[sourceId] +
      t * (system.posZ[targetId] - system.posZ[sourceId]);
    pa[i] =
      system.posW[sourceId] +
      t * (system.posW[targetId] - system.posW[sourceId]);
  }
  const penalties: any[] = [];
  let finalIds: Uint32Array | null = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    buildGridIndex(system, state);
    if (state.gpu) {
      metrics.increment("mapper.gpu_dispatches");
      await relaxPathGPU(
        px,
        py,
        pe,
        pa,
        steps,
        maxIter,
        lr,
        boostScopes,
        penalties,
        system,
        state
      );
    } else {
      metrics.increment("mapper.cpu_dispatches");
      relaxPath(
        px,
        py,
        pe,
        pa,
        steps,
        maxIter,
        lr,
        boostScopes,
        penalties,
        activeAtoms,
        system,
        state
      );
    }
    if (unfolder) {
      let voidDetected = false;
      for (let i = 0; i <= steps; i++) {
        const { potential, nearestId } = _getPotentialAndNearest(
          px[i],
          py[i],
          pe[i],
          pa[i],
          penalties,
          boostScopes,
          activeAtoms,
          system,
          state
        );
        if (
          potential > DOPAT_CONFIG.PHYSICS.VOID_POTENTIAL_THRESHOLD &&
          nearestId !== -1
        ) {
          let expanded = await unfolder.expand(nearestId, options.topic);
          if (!expanded && options.topic) {
            const terms = nlp(options.topic).terms().out("array");
            for (const t of terms) {
              if (await unfolder.expand(nearestId, t)) {
                expanded = true;
                break;
              }
            }
          }
          if (expanded) {
            metrics.increment("mapper.void_expansions");
            voidDetected = true;
            break;
          }
        }
      }
      if (voidDetected) {
        if (state.gpu)
          await relaxPathGPU(
            px,
            py,
            pe,
            pa,
            steps,
            maxIter,
            lr,
            boostScopes,
            penalties,
            system,
            state
          );
        else
          relaxPath(
            px,
            py,
            pe,
            pa,
            steps,
            maxIter,
            lr,
            boostScopes,
            penalties,
            activeAtoms,
            system,
            state
          );
      }
    }
    const report = _review(px, py, pe, pa, steps, activeAtoms, system, state);
    if (report.passed) {
      metrics.record("mapper.iters_to_converge", attempt + 1);
      finalIds = _extractIds(
        px,
        py,
        pe,
        pa,
        steps,
        options.preExpandLength || 0,
        targetId,
        system,
        state
      );
      _updateChristoffels(1.0, state);
      break;
    } else if (report.trapIndex !== undefined) {
      penalties.push({
        x: px[report.trapIndex],
        y: py[report.trapIndex],
        z: pe[report.trapIndex],
        w: pa[report.trapIndex],
        strength: DOPAT_CONFIG.mapper.TRAP_PENALTY,
      });
      _updateChristoffels(-1.0, state);
    }
  }

  computeHolonomy(px, py, pe, pa, steps, state);
  if (finalIds !== null)
    metrics.gauge("transport.inferential_effort", state.lastInferentialEffort);
  const result =
    finalIds ||
    _extractIds(
      px,
      py,
      pe,
      pa,
      steps,
      options.preExpandLength || 0,
      targetId,
      system,
      state
    );
  reinforcePath(result, system);
  return result;
}
