import nlp from "compromise";
import logger from "@utils/SpectralLogger";
import { TensorMath_GPU } from "@core_s/Math";
import type System from "./System";
import type Unfolder from "@core_s/Unfolder";
import { DOPAT_CONFIG } from "@config";

/**
 * The Mapper is responsible for finding the shortest logical path (Geodesic)
 * through the Dual-Layer Manifold. It treats logical derivation as a
 * physical process of "falling" through a potential field defined by:
 *
 * 1. Matter Coordinates (posX): The semantic location of content.
 * 2. Kind Coordinates (posY): The structural category of the precept.
 * 3. Energy Coordinates (posZ): The logical potential/consequence depth.
 * 4. Age Coordinates (posW): The temporal context/loom.
 */
class Mapper implements Mapping.Engine {
  /** The logical manifold providing the physical state of all precepts. */
  private system: System;
  /** Optional GPU math engine for acceleration. */
  private gpu: TensorMath_GPU | null = null;
  /** Optional Fractal Unfolder for expanding logical voids. */
  private unfolder: Unfolder | null = null;
  /** WebGPU pipeline for geodesic calculations. */
  private geodesicPipeline: GPUComputePipeline | null = null;

  /**
   * Initializes the mapper with a reference to the dual-layer manifold.
   */
  constructor(
    system: System,
    gpu: TensorMath_GPU | null = null,
    unfolder: Unfolder | null = null
  ) {
    this.system = system;
    this.gpu = gpu;
    this.unfolder = unfolder;
  }

  /**
   * Sets or updates the GPU engine used by the mapper.
   */
  public setGPU(gpu: TensorMath_GPU | null): void {
    this.gpu = gpu;
    this.geodesicPipeline = null;
  }

  /**
   * Sets or updates the Unfolder engine used by the mapper.
   */
  public setUnfolder(unfolder: Unfolder | null): void {
    this.unfolder = unfolder;
  }

  /**
   * Calculates the optimal geodesic path through the logic manifold.
   *
   * @param sourceId Starting quantum ID.
   * @param targetId Destination quantum ID.
   * @param options Routing parameters.
   * @returns A sequence of quantum IDs representing the logical derivation.
   */
  public async route(
    sourceId: number,
    targetId: number,
    options: Mapping.RouteOptions = {}
  ): Promise<Uint32Array> {
    const steps = options.steps ?? 32;
    const boostScopes = options.boostScopes;
    const learningRate = options.learningRate ?? 0.05;
    const maxIterations = options.maxIterations ?? 100;
    const verbose = options.verbose ?? false;

    // 1. Initialize 4D Path State (Matter, Kind, Energy, Age).
    const px = new Float32Array(steps + 1); // posX
    const py = new Float32Array(steps + 1); // posY
    const pe = new Float32Array(steps + 1); // posZ (Energy)
    const pa = new Float32Array(steps + 1); // posW (Age)

    // Linear interpolation for initial guess across the dual-layer coordinates.
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      px[i] =
        this.system.posX[sourceId] +
        t * (this.system.posX[targetId] - this.system.posX[sourceId]);
      py[i] =
        this.system.posY[sourceId] +
        t * (this.system.posY[targetId] - this.system.posY[sourceId]);
      pe[i] =
        this.system.posZ[sourceId] +
        t * (this.system.posZ[targetId] - this.system.posZ[sourceId]);
      pa[i] =
        this.system.posW[sourceId] +
        t * (this.system.posW[targetId] - this.system.posW[sourceId]);
    }

    const penalties: {
      x: number;
      y: number;
      z: number;
      w: number;
      strength: number;
    }[] = [];
    let finalIds: Uint32Array | null = null;

    // 2. Iterative Relaxation using Manifold Potential Field.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (this.gpu) {
        await this.relaxPathGPU(
          px,
          py,
          pe,
          pa,
          steps,
          maxIterations,
          learningRate,
          boostScopes,
          penalties
        );
      } else {
        this.relaxPath(
          px,
          py,
          pe,
          pa,
          steps,
          maxIterations,
          learningRate,
          boostScopes,
          penalties
        );
      }

      // Check for logical voids and trigger the Unfolder.
      if (this.unfolder) {
        let voidDetected = false;
        for (let i = 0; i <= steps; i++) {
          const { potential, nearestId } = this.getPotentialAndNearest(
            px[i],
            py[i],
            pe[i],
            pa[i],
            penalties,
            boostScopes
          );
          if (potential > DOPAT_CONFIG.PHYSICS.VOID_POTENTIAL_THRESHOLD) {
            if (nearestId !== -1) {
              let expanded = await this.unfolder.expand(
                nearestId,
                options.topic
              );
              if (!expanded && options.topic) {
                const terms = nlp(options.topic).terms().out("array");
                for (const term of terms) {
                  const tExpanded = await this.unfolder.expand(nearestId, term);
                  if (tExpanded) expanded = true;
                }
              }
              if (expanded) {
                voidDetected = true;
                break;
              }
            }
          }
        }
        if (voidDetected) {
          if (this.gpu)
            await this.relaxPathGPU(
              px,
              py,
              pe,
              pa,
              steps,
              maxIterations,
              learningRate,
              boostScopes,
              penalties
            );
          else
            this.relaxPath(
              px,
              py,
              pe,
              pa,
              steps,
              maxIterations,
              learningRate,
              boostScopes,
              penalties
            );
        }
      }

      const report = this.review(px, py, pe, pa, steps);
      if (report.passed) {
        finalIds = this.extractIds(
          px,
          py,
          pe,
          pa,
          steps,
          options.preExpandLength || 0,
          targetId
        );
        break;
      } else if (report.trapIndex !== undefined) {
        penalties.push({
          x: px[report.trapIndex],
          y: py[report.trapIndex],
          z: pe[report.trapIndex],
          w: pa[report.trapIndex],
          strength: 1000.0,
        });
      }
    }

    return (
      finalIds ||
      this.extractIds(
        px,
        py,
        pe,
        pa,
        steps,
        options.preExpandLength || 0,
        targetId
      )
    );
  }

  /**
   * Performs gradient descent on the logic density field using GPU acceleration.
   */
  private async relaxPathGPU(
    px: Float32Array,
    py: Float32Array,
    pe: Float32Array,
    pa: Float32Array,
    steps: number,
    maxIterations: number,
    learningRate: number,
    boostScopes: Set<number> | undefined,
    penalties: any[]
  ): Promise<void> {
    if (!this.geodesicPipeline) await this.initGPUPipeline();
    const device = await TensorMath_GPU.getDevice();
    const sysLength = this.system.length;

    const sysInfluence = new Float32Array(sysLength);
    for (let j = 0; j < sysLength; j++) {
      // Influence is derived from Matter Density and Energy Intensity
      // Syntactic Markov Chain Baseline: +5.0 to ensure operands are visible
      let influence =
        this.system.density[j] * 2.0 + this.system.intensity[j] * 1.5 + 5.0;
      if (boostScopes?.has(this.system.scope[j])) {
        // Moderate additive boost: makes topic keywords ~10x the baseline (50/5),
        // not ~556x (c^2*10/5). A massive boost collapses the path to a point attractor.
        influence += 50.0;
      }
      sysInfluence[j] = influence;
    }

    const penaltyData = new Float32Array(Math.max(1, penalties.length) * 8);
    penalties.forEach((p, i) => {
      penaltyData[i * 8 + 0] = p.x;
      penaltyData[i * 8 + 1] = p.y;
      penaltyData[i * 8 + 2] = p.z;
      penaltyData[i * 8 + 3] = p.w;
      penaltyData[i * 8 + 4] = p.strength;
    });

    const pathData = new Float32Array((steps + 1) * 4);
    for (let i = 0; i <= steps; i++) {
      pathData[i * 4 + 0] = px[i];
      pathData[i * 4 + 1] = py[i];
      pathData[i * 4 + 2] = pe[i];
      pathData[i * 4 + 3] = pa[i];
    }

    const sysPosData = new Float32Array(sysLength * 4);
    for (let j = 0; j < sysLength; j++) {
      sysPosData[j * 4 + 0] = this.system.posX[j];
      sysPosData[j * 4 + 1] = this.system.posY[j];
      sysPosData[j * 4 + 2] = this.system.posZ[j];
      sysPosData[j * 4 + 3] = this.system.posW[j];
    }

    const createB = (data: any, size: number, usage: number) => {
      const b = device.createBuffer({ size, usage });
      if (data) device.queue.writeBuffer(b, 0, data);
      return b;
    };

    const bPath = createB(
      pathData,
      pathData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    );
    const bSysPos = createB(
      sysPosData,
      sysPosData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const bSysInfluence = createB(
      sysInfluence,
      sysInfluence.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const bPenalties = createB(
      penaltyData,
      penaltyData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    const phys = DOPAT_CONFIG.PHYSICS;
    const params = new ArrayBuffer(48);
    const view = new DataView(params);
    view.setUint32(0, steps, true);
    view.setUint32(4, sysLength, true);
    view.setFloat32(8, learningRate, true);
    view.setUint32(12, penalties.length, true);
    view.setUint32(16, maxIterations, true);
    view.setFloat32(20, phys.GRADIENT_STEP, true);
    view.setFloat32(24, phys.INFLUENCE_RADIUS, true);
    view.setFloat32(28, phys.INFLUENCE_FALLOFF, true);
    view.setFloat32(32, phys.PENALTY_RADIUS, true);
    view.setFloat32(36, phys.PENALTY_FALLOFF, true);

    const bParams = createB(
      params,
      48,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );
    const bReadPath = createB(
      undefined,
      pathData.byteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    );

    const bg = device.createBindGroup({
      layout: this.geodesicPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bPath } },
        { binding: 1, resource: { buffer: bSysPos } },
        { binding: 2, resource: { buffer: bSysInfluence } },
        { binding: 3, resource: { buffer: bPenalties } },
        { binding: 4, resource: { buffer: bParams } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.geodesicPipeline!);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(bPath, 0, bReadPath, 0, pathData.byteLength);
    device.queue.submit([encoder.finish()]);

    await bReadPath.mapAsync(GPUMapMode.READ);
    const resPath = new Float32Array(bReadPath.getMappedRange().slice(0));
    bReadPath.unmap();

    for (let i = 0; i <= steps; i++) {
      px[i] = resPath[i * 4];
      py[i] = resPath[i * 4 + 1];
      pe[i] = resPath[i * 4 + 2];
      pa[i] = resPath[i * 4 + 3];
    }
    [bPath, bSysPos, bSysInfluence, bPenalties, bParams, bReadPath].forEach(b =>
      b.destroy()
    );
  }

  /**
   * Initializes the GPU compute pipeline for 4D geodesic calculations.
   */
  private async initGPUPipeline(): Promise<void> {
    const device = await TensorMath_GPU.getDevice();
    const geodesicShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> pathData: array<vec4<f32>>;
        @group(0) @binding(1) var<storage, read> sysPos: array<vec4<f32>>;
        @group(0) @binding(2) var<storage, read> sysInfluence: array<f32>;
        struct Penalty { pos: vec4<f32>, strength: f32, _p1: f32, _p2: f32, _p3: f32 };
        @group(0) @binding(3) var<storage, read> penalties: array<Penalty>;
        struct Params { steps: u32, sysLength: u32, lr: f32, penCount: u32, iter: u32, h: f32, iR: f32, iF: f32, pR: f32, pF: f32 };
        @group(0) @binding(4) var<uniform> params: Params;

        fn potentialAt(p: vec4<f32>) -> f32 {
            var d = 1.0;
            for (var j = 0u; j < params.sysLength; j = j + 1u) {
                let diff = p - sysPos[j];
                let distSq = dot(diff, diff);
                if (distSq < params.iR) {
                    var influence = sysInfluence[j];
                    let dw = diff.w; // Age Context
                    influence = influence * exp(-(dw * 50.0) * (dw * 50.0)); // Context Anisotropy
                    if (sysPos[j].w < p.w - 0.01) { influence = influence * 0.01; } // Arrow of Logic
                    d = d - influence * exp(-distSq / params.iF);
                }
            }
            for (var k = 0u; k < params.penCount; k = k + 1u) {
                let diff = p - penalties[k].pos;
                let distSq = dot(diff, diff);
                if (distSq < params.pR) { d = d + penalties[k].strength * exp(-distSq / params.pF); }
            }
            return max(0.01, d);
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            let i = id.x;
            for (var it = 0u; it < params.iter; it = it + 1u) {
                if (i > 0u && i < params.steps) {
                    let curr = pathData[i];
                    let h = params.h;
                    let d0 = potentialAt(curr);
                    let grad = vec4<f32>(
                        (potentialAt(vec4<f32>(curr.x+h, curr.y, curr.z, curr.w)) - potentialAt(vec4<f32>(curr.x-h, curr.y, curr.z, curr.w)))/(2.0*h),
                        (potentialAt(vec4<f32>(curr.x, curr.y+h, curr.z, curr.w)) - potentialAt(vec4<f32>(curr.x, curr.y-h, curr.z, curr.w)))/(2.0*h),
                        (potentialAt(vec4<f32>(curr.x, curr.y, curr.z+h, curr.w)) - potentialAt(vec4<f32>(curr.x, curr.y, curr.z-h, curr.w)))/(2.0*h),
                        (potentialAt(vec4<f32>(curr.x, curr.y, curr.z, curr.w+h)) - potentialAt(vec4<f32>(curr.x, curr.y, curr.z, curr.w-h)))/(2.0*h)
                    );
                    let spring = (pathData[i-1u] + pathData[i+1u])/2.0 - curr;
                    let displacement = params.lr * (spring * 2.0 - grad);
                    
                    var next = curr + displacement;
                    // Semi-implicit integration: apply soft constraints to maintain flow without hard clipping
                    let ageDiff = next.w - pathData[i-1u].w;
                    if (ageDiff < 0.0) { next.w = next.w - ageDiff * 0.9; } // Soft asymmetric rebound
                    pathData[i] = next;
                }
                storageBarrier();
            }
        }
      `,
    });
    this.geodesicPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: geodesicShader, entryPoint: "main" },
    });
  }

  /**
   * Performs gradient descent on the logic density field.
   */
  private relaxPath(
    px: Float32Array,
    py: Float32Array,
    pe: Float32Array,
    pa: Float32Array,
    steps: number,
    maxIterations: number,
    lr: number,
    boost: Set<number> | undefined,
    penalties: any[]
  ): void {
    const phys = DOPAT_CONFIG.PHYSICS;
    for (let iter = 0; iter < maxIterations; iter++) {
      for (let i = 1; i < steps; i++) {
        const h = phys.GRADIENT_STEP;
        const gx =
          (this.getPotential(px[i] + h, py[i], pe[i], pa[i], penalties, boost) -
            this.getPotential(
              px[i] - h,
              py[i],
              pe[i],
              pa[i],
              penalties,
              boost
            )) /
          (2.0 * h);
        const gy =
          (this.getPotential(px[i], py[i] + h, pe[i], pa[i], penalties, boost) -
            this.getPotential(
              px[i],
              py[i] - h,
              pe[i],
              pa[i],
              penalties,
              boost
            )) /
          (2.0 * h);
        const ge =
          (this.getPotential(px[i], py[i], pe[i] + h, pa[i], penalties, boost) -
            this.getPotential(
              px[i],
              py[i],
              pe[i] - h,
              pa[i],
              penalties,
              boost
            )) /
          (2.0 * h);
        const ga =
          (this.getPotential(px[i], py[i], pe[i], pa[i] + h, penalties, boost) -
            this.getPotential(
              px[i],
              py[i],
              pe[i],
              pa[i] - h,
              penalties,
              boost
            )) /
          (2.0 * h);

        const sx = (px[i - 1] + px[i + 1]) / 2 - px[i];
        const sy = (py[i - 1] + py[i + 1]) / 2 - py[i];
        const se = (pe[i - 1] + pe[i + 1]) / 2 - pe[i];
        const sa = (pa[i - 1] + pa[i + 1]) / 2 - pa[i];

        px[i] += lr * (sx * 2.0 - gx);
        py[i] += lr * (sy * 2.0 - gy);
        pe[i] += lr * (se * 2.0 - ge);

        // Soft Asymmetric Monotonic Age Traversal (Semi-implicit constraint)
        const da_move = lr * (sa * 2.0 - ga);
        pa[i] += da_move;

        const ageDiff = pa[i] - pa[i - 1];
        if (ageDiff < 0) pa[i] -= ageDiff * 0.9; // Soft rebound
        if (i < steps) {
          const nextAgeDiff = pa[i + 1] - pa[i];
          if (nextAgeDiff < 0) pa[i] += nextAgeDiff * 0.9;
        }
      }
    }
  }

  private getPotential(
    x: number,
    y: number,
    z: number,
    w: number,
    pens: any[],
    boost: Set<number> | undefined
  ): number {
    const phys = DOPAT_CONFIG.PHYSICS;
    let pot = 1.0;
    for (let j = 0; j < this.system.length; j++) {
      const dx = x - this.system.posX[j],
        dy = y - this.system.posY[j],
        dz = z - this.system.posZ[j],
        dw = w - this.system.posW[j];
      const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
      if (distSq < phys.INFLUENCE_RADIUS) {
        // Syntactic Markov Chain Baseline: Ensure all logical nodes (operands) have enough
        // topological weight to form localized grammatical trenches, instead of being invisible.
        let infl =
          this.system.density[j] * 2.0 + this.system.intensity[j] * 1.5 + 5.0;
        // Moderate additive boost: 10x baseline, not 556x.
        if (boost?.has(this.system.scope[j])) infl += 50.0;
        infl *= Math.exp(-Math.pow(dw * 50.0, 2)); // Contextual Anisotropy
        if (this.system.posW[j] < w - 0.01) infl *= 0.01; // Arrow of Logic
        pot -= infl * Math.exp(-distSq / phys.INFLUENCE_FALLOFF);
      }
    }
    if (pens) {
      pens.forEach(p => {
        const dx = x - p.x,
          dy = y - p.y,
          dz = z - p.z,
          dw = w - p.w;
        const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
        if (distSq < phys.PENALTY_RADIUS)
          pot += p.strength * Math.exp(-distSq / phys.PENALTY_FALLOFF);
      });
    }
    return Math.max(0.01, pot);
  }

  private getPotentialAndNearest(
    x: number,
    y: number,
    z: number,
    w: number,
    pens: any[],
    boost: Set<number> | undefined
  ): { potential: number; nearestId: number } {
    const phys = DOPAT_CONFIG.PHYSICS;
    let pot = 1.0,
      minDistSq = Infinity,
      nearestId = -1;
    for (let j = 0; j < this.system.length; j++) {
      const dx = x - this.system.posX[j],
        dy = y - this.system.posY[j],
        dz = z - this.system.posZ[j],
        dw = w - this.system.posW[j];
      const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearestId = j;
      }
      if (distSq < phys.INFLUENCE_RADIUS) {
        // Syntactic Markov Chain Baseline
        let infl =
          this.system.density[j] * 2.0 + this.system.intensity[j] * 1.5 + 5.0;
        if (boost?.has(this.system.scope[j])) infl += 50.0;
        infl *= Math.exp(-Math.pow(dw * 50.0, 2));
        if (this.system.posW[j] < w - 0.01) infl *= 0.01;
        pot -= infl * Math.exp(-distSq / phys.INFLUENCE_FALLOFF);
      }
    }
    if (pens) {
      pens.forEach(p => {
        const dx = x - p.x,
          dy = y - p.y,
          dz = z - p.z,
          dw = w - p.w;
        const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
        if (distSq < phys.PENALTY_RADIUS)
          pot += p.strength * Math.exp(-distSq / phys.PENALTY_FALLOFF);
      });
    }
    return { potential: Math.max(0.01, pot), nearestId };
  }

  private review(
    px: Float32Array,
    py: Float32Array,
    pe: Float32Array,
    pa: Float32Array,
    steps: number
  ): Mapping.ReviewReport {
    const phys = DOPAT_CONFIG.PHYSICS;
    for (let i = 1; i < steps; i++) {
      let nearestDistSq = Infinity,
        nearestId = -1;
      for (let j = 0; j < this.system.length; j++) {
        const dSq =
          Math.pow(px[i] - this.system.posX[j], 2) +
          Math.pow(py[i] - this.system.posY[j], 2) +
          Math.pow(pe[i] - this.system.posZ[j], 2) +
          Math.pow(pa[i] - this.system.posW[j], 2);
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestId = j;
        }
      }
      if (nearestId !== -1 && nearestDistSq < phys.TRAP_DISTANCE_THRESHOLD) {
        if (
          this.system.density[nearestId] > phys.TRAP_MASS_THRESHOLD &&
          this.system.entropyRate[nearestId] < phys.TRAP_ENTROPY_THRESHOLD
        ) {
          return { passed: false, reason: "Logic Trap detected", trapIndex: i };
        }
      }
    }
    return { passed: true };
  }

  private extractIds(
    px: Float32Array,
    py: Float32Array,
    pe: Float32Array,
    pa: Float32Array,
    steps: number,
    preExpandLength: number = 0,
    targetId: number = -1
  ): Uint32Array {
    const resultIds: number[] = [];
    const maxPosYByLayer = new Map<number, number>();

    for (let i = 0; i <= steps; i++) {
      let bestId = -1,
        minDiff = Infinity;
      for (let j = 0; j < this.system.length; j++) {
        // Prevent path from snapping to past memory queries globally (excluding exact target)
        if (j < preExpandLength && j !== targetId) continue;

        const dx = this.system.posX[j] - px[i],
          dy = this.system.posY[j] - py[i],
          dz = this.system.posZ[j] - pe[i],
          dw = this.system.posW[j] - pa[i];
        const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
        let totalDiff = distSq + dw * dw * 1000000.0; // Massive context snapping penalty

        const layerJ = Math.floor(this.system.posZ[j] / 10.0);

        // Monotonic Grammatical Filter:
        // Ensure grammatical continuity per fact layer. We track the furthest we've read
        // in each fact (posZ layer) and heavily penalize reading backward.
        const maxPosY = maxPosYByLayer.get(layerJ) ?? -Infinity;
        if (this.system.posY[j] < maxPosY) {
          totalDiff += 1000000.0; // Extreme penalty for backwards syntax
        }

        if (totalDiff < minDiff) {
          if (
            !(
              this.system.density[j] >
                DOPAT_CONFIG.PHYSICS.TRAP_MASS_THRESHOLD &&
              this.system.entropyRate[j] <
                DOPAT_CONFIG.PHYSICS.TRAP_ENTROPY_THRESHOLD
            )
          ) {
            minDiff = totalDiff;
            bestId = j;
          }
        }
      }
      if (
        bestId !== -1 &&
        (resultIds.length === 0 || resultIds[resultIds.length - 1] !== bestId)
      ) {
        /** Continuous Path Reconstruction:
         *  If the sampled points jump across multiple words within the SAME grammatical trench (posZ layer),
         *  it means the continuous physical path rolled over the intermediate words. We must fill them in
         *  to fully reconstruct the bridging syntax.
         */
        const layerBest = Math.floor(this.system.posZ[bestId] / 10.0);

        if (resultIds.length > 0) {
          const lastId = resultIds[resultIds.length - 1];
          const layerLast = Math.floor(this.system.posZ[lastId] / 10.0);

          if (layerLast === layerBest && bestId > lastId) {
            // only fill in the gap if it's reasonably small (e.g. < 5 tokens).
            // ff it's a huge jump, it means the path left the trench and returned later.
            if (bestId - lastId < 5) {
              for (let fillId = lastId + 1; fillId < bestId; fillId++) {
                resultIds.push(fillId);
              }
            }
          }
        }

        resultIds.push(bestId);

        // Update the max grammatical position read for this fact layer
        const currentMax = maxPosYByLayer.get(layerBest) ?? -Infinity;
        if (this.system.posY[bestId] > currentMax) {
          maxPosYByLayer.set(layerBest, this.system.posY[bestId]);
        }
      }
    }
    return new Uint32Array(resultIds);
  }
}

export default Mapper;
