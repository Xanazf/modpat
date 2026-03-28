import logger from "@utils/SpectralLogger";
import { TensorMath_GPU } from "@core_s/Math";
import type System from "./System";

/**
 * The Mapper is responsible for finding the shortest logical path
 * through the non-Euclidean manifold of concepts.
 *
 * It treats logical derivation as a physical process of "falling" through
 * a density field of meaning, avoiding contradictions (Logic Traps) while
 * being pulled toward relevant high-mass nodes.
 */
class Mapper implements Mapping.Engine {
  /** The logical manifold providing the physical state of all precepts. */
  private system: System;
  /** Optional GPU math engine for acceleration. */
  private gpu: TensorMath_GPU | null = null;
  /** WebGPU pipeline for geodesic calculations. */
  private geodesicPipeline: GPUComputePipeline | null = null;

  /**
   * Initializes the mapper with a reference to the active logical manifold.
   *
   * @param system The logical manifold.
   * @param gpu Optional GPU engine.
   */
  constructor(system: System, gpu: TensorMath_GPU | null = null) {
    this.system = system;
    this.gpu = gpu;
  }

  /**
   * Sets or updates the GPU engine used by the mapper.
   */
  public setGPU(gpu: TensorMath_GPU | null): void {
    this.gpu = gpu;
    this.geodesicPipeline = null; // Reset pipeline to trigger re-init if needed.
  }

  /**
   * Calculates the optimal geodesic path through the logic manifold.
   * This uses a physics-inspired relaxation technique where the path is
   * pulled towards high-mass/high-entropy "bodies" (concepts) while
   * avoiding "logic traps" (contradictions or irrelevant high-mass nodes).
   *
   * @param sourceId Starting quantum ID.
   * @param targetId Destination quantum ID.
   * @param options Routing parameters including steps and keyword boosts.
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

    if (verbose) {
      logger.step(
        `Mapper: Starting route from ${sourceId} to ${targetId} (Steps: ${steps}, MaxIter: ${maxIterations})`
      );
    }

    // 1. Initialize 4D Path State (X, Y, Entropy, Time).
    // The path exists in a multi-dimensional space beyond simple coordinates.
    const px = new Float32Array(steps + 1);
    const py = new Float32Array(steps + 1);
    const pz = new Float32Array(steps + 1); // Entropy (Z)
    const pw = new Float32Array(steps + 1); // Time (W)

    // Linear interpolation for initial guess: start with a straight line between concepts.
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      px[i] =
        this.system.posX[sourceId] +
        t * (this.system.posX[targetId] - this.system.posX[sourceId]);
      py[i] =
        this.system.posY[sourceId] +
        t * (this.system.posY[targetId] - this.system.posY[sourceId]);
      pz[i] =
        this.system.entropy[sourceId] +
        t * (this.system.entropy[targetId] - this.system.entropy[sourceId]);
      pw[i] =
        this.system.time[sourceId] +
        t * (this.system.time[targetId] - this.system.time[sourceId]);
    }

    const penalties: {
      x: number;
      y: number;
      z: number;
      w: number;
      strength: number;
    }[] = [];
    let finalIds: Uint32Array | null = null;

    // 2. Iterative Refinement with Self-Review.
    // The path is "relaxed" through gradient descent to find the actual geodesic.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (verbose && attempt > 0)
        logger.log(`Mapper: Retrying relaxation (Attempt ${attempt + 1})...`);

      // Relax the path based on concept attraction and trap repulsion.
      if (this.gpu) {
        await this.relaxPathGPU(
          px,
          py,
          pz,
          pw,
          steps,
          maxIterations,
          learningRate,
          boostScopes,
          penalties,
          verbose
        );
      } else {
        this.relaxPath(
          px,
          py,
          pz,
          pw,
          steps,
          maxIterations,
          learningRate,
          boostScopes,
          penalties,
          verbose
        );
      }

      // Review the relaxed path for logical stability.
      const report = this.review(px, py, pz, pw, steps);
      if (report.passed) {
        if (attempt > 0 || verbose) logger.log("Mapper: Path passed review.");
        finalIds = this.extractIds(px, py, pz, pw, steps);
        break;
      } else {
        logger.warn(
          `Mapper: Path review failed on attempt ${attempt + 1}. Reason: ${report.reason}`
        );
        // If a trap was detected, add a repulsion penalty at that location and retry.
        if (report.trapIndex !== undefined) {
          const tx = px[report.trapIndex];
          const ty = py[report.trapIndex];
          penalties.push({
            x: tx,
            y: ty,
            z: pz[report.trapIndex],
            w: pw[report.trapIndex],
            strength: 1000.0, // Massive repulsion for logic traps.
          });
        }
      }
    }

    // Fallback if no perfect path could be found.
    if (!finalIds) {
      logger.warn(
        "Mapper: Failed to find a coherent path after max attempts. Returning best effort."
      );
      finalIds = this.extractIds(px, py, pz, pw, steps);
    }

    return finalIds;
  }

  /**
   * Performs gradient descent on the logic density field using GPU acceleration.
   */
  private async relaxPathGPU(
    px: Float32Array,
    py: Float32Array,
    pz: Float32Array,
    pw: Float32Array,
    steps: number,
    maxIterations: number,
    learningRate: number,
    boostScopes: Set<number> | undefined,
    penalties: {
      x: number;
      y: number;
      z: number;
      w: number;
      strength: number;
    }[],
    verbose: boolean = false
  ): Promise<void> {
    if (!this.geodesicPipeline) {
      await this.initGPUPipeline();
    }

    const device = await TensorMath_GPU.getDevice();
    const sysLength = this.system.length;

    const bPathX = device.createBuffer({
      size: px.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    const bPathY = device.createBuffer({
      size: py.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    const bSysPosX = device.createBuffer({
      size: sysLength * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bSysPosY = device.createBuffer({
      size: sysLength * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bSysMass = device.createBuffer({
      size: sysLength * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bSysEntropy = device.createBuffer({
      size: sysLength * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bSysOpClass = device.createBuffer({
      size: sysLength * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bParams = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bReadX = device.createBuffer({
      size: px.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const bReadY = device.createBuffer({
      size: py.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    device.queue.writeBuffer(bPathX, 0, px);
    device.queue.writeBuffer(bPathY, 0, py);
    device.queue.writeBuffer(
      bSysPosX,
      0,
      new Float32Array(this.system.posX.subarray(0, sysLength))
    );
    device.queue.writeBuffer(
      bSysPosY,
      0,
      new Float32Array(this.system.posY.subarray(0, sysLength))
    );
    device.queue.writeBuffer(
      bSysMass,
      0,
      new Float32Array(this.system.mass.subarray(0, sysLength))
    );
    device.queue.writeBuffer(
      bSysEntropy,
      0,
      new Float32Array(this.system.entropy.subarray(0, sysLength))
    );
    device.queue.writeBuffer(
      bSysOpClass,
      0,
      new Uint32Array(
        Array.from(this.system.operatorClass.subarray(0, sysLength))
      )
    );

    const params = new ArrayBuffer(32);
    const view = new DataView(params);
    view.setUint32(0, steps, true);
    view.setUint32(4, sysLength, true);
    view.setFloat32(8, learningRate, true);
    view.setFloat32(12, this.system.c, true);
    view.setUint32(16, maxIterations, true);
    view.setFloat32(20, 0.01, true); // h
    device.queue.writeBuffer(bParams, 0, params);

    const bg = device.createBindGroup({
      layout: this.geodesicPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bPathX } },
        { binding: 1, resource: { buffer: bPathY } },
        { binding: 2, resource: { buffer: bSysPosX } },
        { binding: 3, resource: { buffer: bSysPosY } },
        { binding: 4, resource: { buffer: bSysMass } },
        { binding: 5, resource: { buffer: bSysEntropy } },
        { binding: 6, resource: { buffer: bSysOpClass } },
        { binding: 7, resource: { buffer: bParams } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.geodesicPipeline!);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(bPathX, 0, bReadX, 0, px.byteLength);
    encoder.copyBufferToBuffer(bPathY, 0, bReadY, 0, py.byteLength);
    device.queue.submit([encoder.finish()]);

    await Promise.all([
      bReadX.mapAsync(GPUMapMode.READ),
      bReadY.mapAsync(GPUMapMode.READ),
    ]);

    const resX = new Float32Array(bReadX.getMappedRange().slice(0));
    const resY = new Float32Array(bReadY.getMappedRange().slice(0));
    bReadX.unmap();
    bReadY.unmap();

    px.set(resX);
    py.set(resY);

    [
      bPathX,
      bPathY,
      bSysPosX,
      bSysPosY,
      bSysMass,
      bSysEntropy,
      bSysOpClass,
      bParams,
      bReadX,
      bReadY,
    ].forEach(b => b.destroy());
  }

  /**
   * Initializes the GPU compute pipeline for geodesic calculations.
   */
  private async initGPUPipeline(): Promise<void> {
    const device = await TensorMath_GPU.getDevice();
    const geodesicShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> pathX: array<f32>;
        @group(0) @binding(1) var<storage, read_write> pathY: array<f32>;
        @group(0) @binding(2) var<storage, read> sysPosX: array<f32>;
        @group(0) @binding(3) var<storage, read> sysPosY: array<f32>;
        @group(0) @binding(4) var<storage, read> sysMass: array<f32>;
        @group(0) @binding(5) var<storage, read> sysEntropy: array<f32>;
        @group(0) @binding(6) var<storage, read> sysOpClass: array<u32>;
        
        struct Params {
            steps: u32,
            sysLength: u32,
            learningRate: f32,
            c: f32,
            iterations: u32,
            h: f32
        };
        @group(0) @binding(7) var<uniform> params: Params;

        fn densityAt(x: f32, y: f32) -> f32 {
            var d = 1.0;
            for (var j = 0u; j < params.sysLength; j = j + 1u) {
                let dx = x - sysPosX[j];
                let dy = y - sysPosY[j];
                let weightedDistSq = (dx * dx) * 10.0 + (dy * dy) * 0.5;
                
                if (weightedDistSq < 400.0) {
                    let massFactor = sysMass[j] / (params.c * params.c);
                    let entropyFactor = sysEntropy[j];
                    let opClass = sysOpClass[j];
                    
                    var influence = (abs(massFactor) * 1.5 + entropyFactor * 1.0);
                    if (opClass != 0u) { influence = influence * 2.0; }

                    d = d - influence * exp(-weightedDistSq / 50.0);
                }
            }
            return max(0.01, d);
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            let i = id.x;

            for (var iter = 0u; iter < params.iterations; iter = iter + 1u) {
                if (i > 0u && i < params.steps) {
                    let currX = pathX[i];
                    let currY = pathY[i];
                    let h = params.h;

                    let gradX = (densityAt(currX + h, currY) - densityAt(currX, currY)) / h;
                    let gradY = (densityAt(currX, currY + h) - densityAt(currX, currY)) / h;

                    let springX = (pathX[i - 1u] + pathX[i + 1u]) / 2.0 - currX;
                    let springY = (pathY[i - 1u] + pathY[i + 1u]) / 2.0 - currY;

                    pathX[i] = pathX[i] + params.learningRate * (springX - gradX);
                    pathY[i] = pathY[i] + params.learningRate * (springY - gradY);
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
   * Minimizes the path's total energy by balancing:
   * 1. Attraction toward high-mass concepts (Potential Wells).
   * 2. Spring force (Continuity) between nodes to ensure logical flow.
   * 3. Repulsion from identified logic traps.
   *
   * @param px Path X coordinates.
   * @param py Path Y coordinates.
   * @param pz Path Entropy (Z) coordinates.
   * @param pw Path Time (W) coordinates.
   * @param steps Path resolution.
   * @param maxIterations Relaxation depth.
   * @param learningRate Gradient step size.
   * @param boostScopes Scopes to prioritize.
   * @param penalties Repulsion nodes.
   * @param verbose Logging flag.
   */
  private relaxPath(
    px: Float32Array,
    py: Float32Array,
    pz: Float32Array,
    pw: Float32Array,
    steps: number,
    maxIterations: number,
    learningRate: number,
    boostScopes: Set<number> | undefined,
    penalties: {
      x: number;
      y: number;
      z: number;
      w: number;
      strength: number;
    }[],
    verbose: boolean = false
  ): void {
    const c = this.system.c || 1.0;
    const c2 = c * c;

    for (let iter = 0; iter < maxIterations; iter++) {
      let totalGradNorm = 0;
      for (let i = 1; i < steps; i++) {
        const h = 0.01; // Finite difference step for numerical gradient.

        // densityAt calculates the "logical resistance" at a given point in the manifold.
        // Higher density means more logical relevance/attraction.
        const densityAt = (x: number, y: number, z: number, w: number) => {
          let density = 1.0;
          for (let j = 0; j < this.system.length; j++) {
            const dx = x - this.system.posX[j],
              dy = y - this.system.posY[j];
            const dz = z - this.system.entropy[j],
              dw = w - this.system.time[j];
            const distSq = dx * dx + dy * dy + dz * dz + dw * dw;

            // Only consider concepts within a reasonable influence radius.
            if (distSq < 400.0) {
              const massFactor = Math.abs(this.system.mass[j] / c2);
              const entropyFactor = this.system.entropy[j] || 0.1;
              const isBoosted = boostScopes?.has(this.system.scope[j]);

              let influence = massFactor * 2.0 + entropyFactor * 1.5;
              if (isBoosted) influence *= 10.0;

              // Concept Attraction: Create a deep potential well at the location of high-mass concepts.
              density -= influence * Math.exp(-distSq / 40.0);
            }
          }

          // Trap Repulsion: Apply massive resistance at logic trap coordinates.
          for (const p of penalties) {
            const dx = x - p.x,
              dy = y - p.y,
              dz = z - p.z,
              dw = w - p.w;
            const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
            if (distSq < 100.0) {
              density += p.strength * Math.exp(-distSq / 20.0);
            }
          }
          return Math.max(0.01, density);
        };

        // Numerical gradient calculation: find the direction of steepest logical descent.
        const d0 = densityAt(px[i], py[i], pz[i], pw[i]);
        const gx = (densityAt(px[i] + h, py[i], pz[i], pw[i]) - d0) / h;
        const gy = (densityAt(px[i], py[i] + h, pz[i], pw[i]) - d0) / h;
        const gz = (densityAt(px[i], py[i], pz[i] + h, pw[i]) - d0) / h;
        const gw = (densityAt(px[i], py[i], pz[i], pw[i] + h) - d0) / h;

        // Spring Force: Maintains logical smoothness by pulling the node toward its neighbors.
        const sx = (px[i - 1] + px[i + 1]) / 2 - px[i];
        const sy = (py[i - 1] + py[i + 1]) / 2 - py[i];
        const sz = (pz[i - 1] + pz[i + 1]) / 2 - pz[i];
        const sw = (pw[i - 1] + pw[i + 1]) / 2 - pw[i];

        // Update Position: Balance the spring force with the gradient of the density field.
        px[i] += learningRate * (sx - gx);
        py[i] += learningRate * (sy - gy);
        pz[i] += learningRate * (sz - gz);
        pw[i] += learningRate * (sw - gw);

        if (verbose && iter % 10 === 0) {
          totalGradNorm += Math.sqrt(gx * gx + gy * gy + gz * gz + gw * gw);
        }
      }
      if (verbose && iter % 10 === 0) {
        logger.log(
          `  [Relaxation] Iteration ${iter}: Avg Gradient Norm = ${(totalGradNorm / steps).toFixed(4)}`
        );
      }
    }
  }

  /**
   * Reviews the relaxed path for "Logic Traps" - high-mass distraction nodes
   * that lack logical entropy/certainty and could destabilize the derivation.
   *
   * @param px Path X coordinates.
   * @param py Path Y coordinates.
   * @param pz Path Entropy (Z) coordinates.
   * @param pw Path Time (W) coordinates.
   * @param steps Path resolution.
   * @returns A report indicating if the path is logically sound.
   */
  private review(
    px: Float32Array,
    py: Float32Array,
    pz: Float32Array,
    pw: Float32Array,
    steps: number
  ): Mapping.ReviewReport {
    const c = this.system.c || 1.0;
    const c2 = c * c;

    for (let i = 1; i < steps; i++) {
      let nearestDistSq = Infinity,
        nearestId = -1;
      // Identify the nearest manifold concept to this path node.
      for (let j = 0; j < this.system.length; j++) {
        const dx = this.system.posX[j] - px[i],
          dy = this.system.posY[j] - py[i];
        const distSq = dx * dx + dy * dy;
        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestId = j;
        }
      }

      // Check if the nearest concept is a logic trap (Supermassive with no entropy).
      if (nearestId !== -1 && nearestDistSq < 25.0) {
        const massFactor = Math.abs(this.system.mass[nearestId] / c2);
        const entropy = this.system.entropy[nearestId];
        if (massFactor > 500.0 && entropy < 0.1) {
          return { passed: false, reason: "Logic Trap detected", trapIndex: i };
        }
      }
    }
    return { passed: true };
  }

  /**
   * Snapshots the continuous relaxed path into the nearest discrete quantum IDs.
   * This discretization process converts the "physical" path back into logical steps.
   *
   * @param px Path X coordinates.
   * @param py Path Y coordinates.
   * @param pz Path Entropy (Z) coordinates.
   * @param pw Path Time (W) coordinates.
   * @param steps Path resolution.
   * @returns A discrete sequence of quantum IDs.
   */
  private extractIds(
    px: Float32Array,
    py: Float32Array,
    pz: Float32Array,
    pw: Float32Array,
    steps: number
  ): Uint32Array {
    const c = this.system.c || 1.0;
    const c2 = c * c;
    const resultIds: number[] = [];

    for (let i = 0; i <= steps; i++) {
      let bestId = -1,
        minDiff = Infinity;
      // Find the best discrete match in the manifold for this continuous path point.
      for (let j = 0; j < this.system.length; j++) {
        const dx = this.system.posX[j] - px[i],
          dy = this.system.posY[j] - py[i];
        const diffSq = dx * dx + dy * dy;

        if (diffSq < minDiff) {
          const massFactor = Math.abs(this.system.mass[j] / c2);
          // Explicitly avoid snapping to identified Logic Traps.
          const isTrap = massFactor > 500.0 && this.system.entropy[j] < 0.1;

          if (!isTrap) {
            minDiff = diffSq;
            bestId = j;
          }
        }
      }
      // Only push unique consecutive IDs to maintain logical progression.
      if (bestId !== -1) {
        if (
          resultIds.length === 0 ||
          resultIds[resultIds.length - 1] !== bestId
        ) {
          resultIds.push(bestId);
        }
      }
    }
    return new Uint32Array(resultIds);
  }
}

export default Mapper;
