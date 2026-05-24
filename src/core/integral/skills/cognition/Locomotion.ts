/**
 * Locomotion – geodesic traversal as a plain function module.
 *
 * All functions take system, unfolder, and the mutable LocomotionState
 * explicitly. No class instantiation required.
 */

import { DOPAT_CONFIG } from "@config";
import { SlotType } from "@core_i/System";
import { TensorMath_GPU } from "@core_s/Math";
import { metrics } from "@core_s/Metrics";
import { GridIndex4D } from "@mutate/GridIndex4D";
import type Unfolder from "@mutate/Unfolder";
import { CURVATURE_WGSL } from "@props/Curvature";
import nlp from "compromise";

// -- State & deps -----------------------------------------------------------

/** All mutable locomotion state owned by the Traveler. Create with makeLocomotionState(). */
export interface LocomotionState {
  gpu: TensorMath_GPU | null;
  geodesicPipeline: GPUComputePipeline | null;
  readonly gridIndex: GridIndex4D;
  readonly lastHolonomy: Float64Array; // 4×4 – updated each traverse
  lastInferentialEffort: number;
  readonly deltaGamma: Float64Array; // 64 floats – C4 Christoffel corrections
  phiClippedCount: number;
  _lastPathVelocity: [number, number, number, number];
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
  const phys = DOPAT_CONFIG.PHYSICS,
    F = phys.INFLUENCE_FALLOFF;
  let V = 1.0,
    fx = 0.0,
    fy = 0.0,
    fz = 0.0,
    fw = 0.0;
  const actualRadius = Math.sqrt(phys.INFLUENCE_RADIUS);
  const candidates = state.gridIndex.candidatesInRadius(
    px,
    py,
    pz,
    pw,
    actualRadius
  );

  // First pass: compute φ(p)
  let phi = 0.0;
  for (const j of candidates) {
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
    phi += infl * Math.exp(-d2 / F);
  }
  if (phi > phys.PHI_MAX) {
    state.phiClippedCount++;
    phi = phys.PHI_MAX;
  }

  // Second pass: V and force
  for (const j of candidates) {
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
    infl *= Math.exp(
      -phys.PHI_TEMPORAL_DECAY * Math.max(0, pw - system.posW[j])
    );
    if (phys.CONFORMAL_ENABLED) infl *= Math.exp(-2.0 * phi);
    const e = infl * Math.exp(-d2 / F);
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
  for (let iter = 0; iter < maxIterations; iter++) {
    for (let i = 1; i < steps; i++) {
      const [, fx, fy, fz, fw] = getMetricForce(
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
      const [cfx, cfy, cfz, cfw] = _christoffelForce(
        px[i] - px[i - 1],
        py[i] - py[i - 1],
        pe[i] - pe[i - 1],
        pa[i] - pa[i - 1],
        state
      );
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
  const device = await TensorMath_GPU.getDevice();
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
  const device = await TensorMath_GPU.getDevice();
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

function _christoffelForce(
  vx: number,
  vy: number,
  vz: number,
  vw: number,
  state: LocomotionState
): [number, number, number, number] {
  const v = [vx, vy, vz, vw],
    f = [0, 0, 0, 0],
    dG = state.deltaGamma;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const base = i * 16 + j * 4;
      for (let k = 0; k < 4; k++) f[i] += dG[base + k] * v[j] * v[k];
    }
  return [f[0], f[1], f[2], f[3]];
}

function _updateChristoffels(scale: number, state: LocomotionState): void {
  const [vx, vy, vz, vw] = state._lastPathVelocity,
    v = [vx, vy, vz, vw];
  const delta = DOPAT_CONFIG.PHYSICS.CHRISTOFFEL_LR * scale,
    dG = state.deltaGamma;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const base = i * 16 + j * 4;
      for (let k = 0; k < 4; k++) dG[base + k] += delta * v[i] * v[j] * v[k];
    }
}

export function regularizeChristoffels(state: LocomotionState): void {
  const decay = 1 - DOPAT_CONFIG.PHYSICS.CHRISTOFFEL_REGULARIZATION;
  for (let i = 0; i < 64; i++) state.deltaGamma[i] *= decay;
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
  const H = state.lastHolonomy;
  H.fill(0);
  H[0] = H[5] = H[10] = H[15] = 1;
  const R = new Float64Array(16);
  for (let i = 1; i < steps; i++) {
    const ux = px[i] - px[i - 1],
      uy = py[i] - py[i - 1],
      uz = pe[i] - pe[i - 1],
      uw = pa[i] - pa[i - 1];
    const vx = px[i + 1] - px[i],
      vy = py[i + 1] - py[i],
      vz = pe[i + 1] - pe[i],
      vw = pa[i + 1] - pa[i];
    const uMag = Math.sqrt(ux * ux + uy * uy + uz * uz + uw * uw) + 1e-12,
      vMag = Math.sqrt(vx * vx + vy * vy + vz * vz + vw * vw) + 1e-12;
    const ûx = ux / uMag,
      ûy = uy / uMag,
      ûz = uz / uMag,
      ûw = uw / uMag;
    const v̂x = vx / vMag,
      v̂y = vy / vMag,
      v̂z = vz / vMag,
      v̂w = vw / vMag;
    const cosT = Math.max(
      -1,
      Math.min(1, ûx * v̂x + ûy * v̂y + ûz * v̂z + ûw * v̂w)
    );
    if (Math.abs(cosT) > 1 - 1e-10) continue;
    const sinT = Math.sqrt(1 - cosT * cosT);
    const px_ = (v̂x - cosT * ûx) / sinT,
      py_ = (v̂y - cosT * ûy) / sinT,
      pz_ = (v̂z - cosT * ûz) / sinT,
      pw_ = (v̂w - cosT * ûw) / sinT;
    const û = [ûx, ûy, ûz, ûw],
      p_ = [px_, py_, pz_, pw_];
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++)
        R[a * 4 + b] =
          (a === b ? 1 : 0) +
          sinT * (p_[a] * û[b] - û[a] * p_[b]) +
          (cosT - 1) * (û[a] * û[b] + p_[a] * p_[b]);
    const h = Array.from(H);
    for (let a = 0; a < 4; a++)
      for (let c = 0; c < 4; c++)
        H[a * 4 + c] =
          R[a * 4] * h[c] +
          R[a * 4 + 1] * h[4 + c] +
          R[a * 4 + 2] * h[8 + c] +
          R[a * 4 + 3] * h[12 + c];
  }
  let frobSq = 0;
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++) {
      const d = H[a * 4 + b] - (a === b ? 1 : 0);
      frobSq += d * d;
    }
  state.lastInferentialEffort = Math.sqrt(frobSq) / 4;
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
    if (_windingNumber(loop, system.posX[id], system.posY[id]) !== 0)
      straddled.push(bar);
  }
  return {
    homotopic: straddled.length === 0,
    straddledH1Bars: straddled,
    analogyScore:
      qualified.length > 0 ? straddled.length / qualified.length : 0,
  };
}

function _windingNumber(
  loop: [number, number][],
  gx: number,
  gy: number
): number {
  let wn = 0,
    n = loop.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = loop[i],
      [x2, y2] = loop[(i + 1) % n];
    if (y1 <= gy) {
      if (y2 > gy && (x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) > 0) wn++;
    } else {
      if (y2 <= gy && (x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) < 0) wn--;
    }
  }
  return wn;
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
