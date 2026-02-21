/// <reference types="@webgpu/types" />
import gpu from "@kmamal/gpu";

// Polyfill WebGPU constants for Node.js environment
if (typeof globalThis.GPUBufferUsage === "undefined") {
  (globalThis as unknown as Record<string, unknown>).GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  };
}

if (typeof globalThis.GPUMapMode === "undefined") {
  (globalThis as unknown as Record<string, unknown>).GPUMapMode = {
    READ: 0x0001,
    WRITE: 0x0002,
  };
}

/**
 * TensorMath_CPU provides fallback mathematical operations executed on the host processor.
 *
 * In the MODPAT ecosystem, this serves as the "low-gravity" execution environment,
 * used when GPU acceleration is unavailable or for smaller logic topologies where
 * the overhead of GPU transfer outweighs the computation.
 */
class TensorMath_CPU implements PMath.Engine {
  /**
   * Performs matrix multiplication, simulating the gravitational interaction
   * between two operator/variable fields.
   *
   * @param A - The first logical matrix (mass field).
   * @param B - The second logical matrix (influence field).
   * @returns The resulting interaction matrix.
   */
  async matMul(A: PMath.Matrix, B: PMath.Matrix): Promise<PMath.Matrix> {
    const rowsA = A.length;
    const colsB = B[0].length;
    const innerDim = A[0].length;

    const flatA = new Float64Array(A.flat());
    const flatB = new Float64Array(B.flat());

    const res = await this.matMulF64(flatA, flatB, rowsA, colsB, innerDim);

    const result: PMath.Matrix = [];
    for (let i = 0; i < rowsA; i++) {
      result.push(Array.from(res.slice(i * colsB, (i + 1) * colsB)));
    }
    return result;
  }

  /**
   * Direct Float64-compatible matrix multiplication on the CPU.
   */
  async matMulF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64,
    rowsA: number,
    colsB: number,
    innerDim: number
  ): Promise<PMath.Vector64> {
    const res = new Float64Array(rowsA * colsB);

    // Pre-transpose B for cache-friendly access if it's large,
    // but for CPU logic propagation we usually have small N.
    for (let i = 0; i < rowsA; i++) {
      const rowOffset = i * innerDim;
      const resOffset = i * colsB;
      for (let j = 0; j < colsB; j++) {
        let sum = 0;
        for (let k = 0; k < innerDim; k++) {
          sum += A[rowOffset + k] * B[k * colsB + j];
        }
        res[resOffset + j] = sum;
      }
    }
    return res;
  }

  /**
   * Performs element-wise addition, simulating the superposition of two logic fields.
   *
   * @param A - The primary logic field.
   * @param B - The secondary logic field to overlay.
   * @returns The combined logic field.
   */
  async add(A: PMath.Matrix, B: PMath.Matrix): Promise<PMath.Matrix> {
    return A.map((row, i) => row.map((val, j) => val + B[i][j]));
  }

  /**
   * Performs element-wise addition on flat vectors.
   */
  async addF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64
  ): Promise<PMath.Vector64> {
    const res = new Float64Array(A.length);
    for (let i = 0; i < A.length; i++) {
      res[i] = A[i] + B[i];
    }
    return res;
  }

  /**
   * Multiplies a flat vector by a scalar.
   */
  async mulScalarF64(
    A: PMath.Vector32_64,
    scalar: number
  ): Promise<PMath.Vector64> {
    const res = new Float64Array(A.length);
    for (let i = 0; i < A.length; i++) {
      res[i] = A[i] * scalar;
    }
    return res;
  }

  /**
   * Applies the Rectified Linear Unit (ReLU) function to a matrix,
   * simulating the thresholding/activation of signals within the topology.
   *
   * @param A - The logic matrix to activate.
   * @returns The activated matrix where negative influences are attenuated to zero.
   */
  async relu(A: PMath.Matrix): Promise<PMath.Matrix> {
    return A.map(row => row.map(val => Math.max(0, val)));
  }

  /**
   * Applies the Rectified Linear Unit (ReLU) function to a vector.
   *
   * @param A - The logic vector to activate.
   * @returns The activated vector.
   */
  async reluV(A: PMath.Vector): Promise<PMath.Vector> {
    return A.map(v => Math.max(0, v));
  }

  /**
   * Calculates the softmax of a vector, representing the probability distribution
   * of logical outcomes within a field.
   *
   * @param vector - The raw influence vector.
   * @returns A normalized probability distribution.
   */
  async softmax(vector: PMath.Vector): Promise<PMath.Vector> {
    const exp = vector.map(v => Math.exp(v));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  /**
   * Disposes of any resources used by the CPU engine.
   */
  async dispose(): Promise<void> {}
}

/**
 * TensorMath_GPU provides high-performance mathematical operations offloaded
 * to the GPU via WebGPU.
 *
 * In the MODPAT ecosystem, this is the "high-gravity" environment, essential for
 * simulating complex attenuation topologies and calculating geodesic paths
 * through dense operator fields.
 */
class TensorMath_GPU implements PMath.Engine {
  /** The shared WebGPU device. */
  private static device: GPUDevice | null = null;
  /** Internal instance of the kmamal/gpu binding. */
  private static instance: GPU | null = null;

  private matMulPipeline: GPUComputePipeline | null = null;
  private addPipeline: GPUComputePipeline | null = null;
  private mulScalarPipeline: GPUComputePipeline | null = null;
  private reluPipeline: GPUComputePipeline | null = null;
  private softmaxPipeline: GPUComputePipeline | null = null;

  /**
   * Creates a new GPU math engine.
   * @param device - Optional existing GPUDevice to use.
   */
  constructor(device?: GPUDevice) {
    if (device) TensorMath_GPU.device = device;
  }

  /**
   * Retrieves or initializes the WebGPU device.
   * @returns The active GPUDevice.
   */
  static async getDevice(): Promise<GPUDevice> {
    if (TensorMath_GPU.device) return TensorMath_GPU.device;

    let gpuImpl: GPU | undefined;
    if (typeof navigator !== "undefined" && navigator.gpu) {
      gpuImpl = navigator.gpu;
    } else {
      if (!TensorMath_GPU.instance) {
        TensorMath_GPU.instance = gpu.create([]);
      }
      gpuImpl = TensorMath_GPU.instance as unknown as GPU;
    }

    if (!gpuImpl) throw new Error("WebGPU not supported.");
    const adapter = await gpuImpl.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("No GPU found.");
    TensorMath_GPU.device = await adapter.requestDevice();
    return TensorMath_GPU.device;
  }

  /**
   * Factory method to create and initialize a TensorMath_GPU instance.
   */
  static async create(): Promise<TensorMath_GPU> {
    const tm = new TensorMath_GPU();
    await tm.init();
    return tm;
  }

  /**
   * Initializes the GPU device and compute pipelines.
   */
  async init() {
    if (!TensorMath_GPU.device) {
      TensorMath_GPU.device = await TensorMath_GPU.getDevice();
    }
    if (!this.matMulPipeline) {
      await this.initPipelines();
    }
  }

  /**
   * Compiles and initializes the WGSL shaders for logical operations.
   * @private
   */
  private async initPipelines() {
    const device = TensorMath_GPU.device!;

    // Matrix Multiplication Shader (Gravitational Interaction)
    const matMulShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read> A: array<f32>;
        @group(0) @binding(1) var<storage, read> B: array<f32>;
        @group(0) @binding(2) var<storage, read_write> C: array<f32>;
        struct Params { rowsA: f32, colsB: f32, innerDim: f32, padding: f32 };
        @group(0) @binding(3) var<uniform> params: Params;

        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            let row = id.y;
            let col = id.x;
            let rowsA = u32(params.rowsA);
            let colsB = u32(params.colsB);
            let innerDim = u32(params.innerDim);

            if (row >= rowsA || col >= colsB) { return; }

            var sum = 0.0;
            for (var k = 0u; k < innerDim; k = k + 1u) {
                sum = sum + A[row * innerDim + k] * B[k * colsB + col];
            }
            C[row * colsB + col] = sum;
        }
      `,
    });
    this.matMulPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: matMulShader, entryPoint: "main" },
    });

    // Element-wise Addition Shader (Field Superposition)
    const addShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read> A: array<f32>;
        @group(0) @binding(1) var<storage, read> B: array<f32>;
        @group(0) @binding(2) var<storage, read_write> C: array<f32>;
        struct Params { size: u32, p1: u32, p2: u32, p3: u32 };
        @group(0) @binding(3) var<uniform> params: Params;

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            let index = id.x;
            if (index >= params.size) { return; }
            C[index] = A[index] + B[index];
        }
      `,
    });
    this.addPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: addShader, entryPoint: "main" },
    });

    // Element-wise Scalar Multiplication Shader
    const mulScalarShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read> A: array<f32>;
        @group(0) @binding(1) var<storage, read_write> C: array<f32>;
        struct Params { size: u32, scalar: f32, p2: u32, p3: u32 };
        @group(0) @binding(2) var<uniform> params: Params;

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            let index = id.x;
            if (index >= params.size) { return; }
            C[index] = A[index] * params.scalar;
        }
      `,
    });
    this.mulScalarPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: mulScalarShader, entryPoint: "main" },
    });

    // ReLU Shader (Signal Thresholding)
    const reluShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read> A: array<f32>;
        @group(0) @binding(1) var<storage, read_write> C: array<f32>;
        struct Params { size: u32, p1: u32, p2: u32, p3: u32 };
        @group(0) @binding(2) var<uniform> params: Params;

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            let index = id.x;
            if (index >= params.size) { return; }
            C[index] = max(0.0, A[index]);
        }
      `,
    });
    this.reluPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: reluShader, entryPoint: "main" },
    });

    // Softmax Shader (Outcome Probability)
    const softmaxShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read> A: array<f32>;
        @group(0) @binding(1) var<storage, read_write> C: array<f32>;
        struct Params { size: u32, p1: u32, p2: u32, p3: u32 };
        @group(0) @binding(2) var<uniform> params: Params;

        @compute @workgroup_size(1)
        fn main() {
            var m = -1e38;
            for (var i = 0u; i < params.size; i = i + 1u) {
                if (A[i] > m) { m = A[i]; }
            }
            var s = 0.0;
            for (var i = 0u; i < params.size; i = i + 1u) {
                s = s + exp(A[i] - m);
            }
            for (var i = 0u; i < params.size; i = i + 1u) {
                C[i] = exp(A[i] - m) / s;
            }
        }
      `,
    });
    this.softmaxPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: softmaxShader, entryPoint: "main" },
    });
  }

  /**
   * Flattens a logic matrix into a contiguous Float32Array for GPU transfer.
   * @private
   */
  private flatten(matrix: PMath.Matrix): Float32Array {
    return new Float32Array(matrix.flat());
  }

  /**
   * Restructures a flat GPU result buffer back into a logic matrix.
   * @private
   */
  private unflatten(
    flat: Float32Array,
    rows: number,
    cols: number
  ): PMath.Matrix {
    const result: PMath.Matrix = [];
    for (let i = 0; i < rows; i++) {
      result.push(Array.from(flat.slice(i * cols, (i + 1) * cols)));
    }
    return result;
  }

  /**
   * Dispatches an element-wise compute shader to the GPU.
   * @private
   */
  private async dispatchElementwise(
    A: Float32Array,
    B: Float32Array | null,
    pipeline: GPUComputePipeline,
    sizeC: number,
    paramsArray: Uint32Array,
    workgroups: number
  ): Promise<Float32Array> {
    const device = TensorMath_GPU.device!;

    const bufA = device.createBuffer({
      size: A.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bufB = B
      ? device.createBuffer({
          size: B.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
      : null;
    const bufC = device.createBuffer({
      size: sizeC,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const bufParams = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bufRead = device.createBuffer({
      size: sizeC,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    device.queue.writeBuffer(bufA, 0, A as GPUAllowSharedBufferSource);
    if (bufB && B)
      device.queue.writeBuffer(bufB, 0, B as GPUAllowSharedBufferSource);
    device.queue.writeBuffer(
      bufParams,
      0,
      paramsArray as GPUAllowSharedBufferSource
    );

    const entries: GPUBindGroupEntry[] = [];
    entries.push({ binding: 0, resource: { buffer: bufA } });
    if (bufB) entries.push({ binding: 1, resource: { buffer: bufB } });
    entries.push({ binding: bufB ? 2 : 1, resource: { buffer: bufC } });
    entries.push({ binding: bufB ? 3 : 2, resource: { buffer: bufParams } });

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries,
    });

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(workgroups);
    passEncoder.end();

    commandEncoder.copyBufferToBuffer(bufC, 0, bufRead, 0, sizeC);
    device.queue.submit([commandEncoder.finish()]);

    await bufRead.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(bufRead.getMappedRange().slice(0));
    bufRead.unmap();

    [bufA, bufC, bufParams, bufRead].forEach(b => b.destroy());
    if (bufB) bufB.destroy();

    return result;
  }

  /**
   * High-performance matrix multiplication on the GPU.
   * Simulates deep gravitational interaction between logical fields.
   */
  async matMul(A: PMath.Matrix, B: PMath.Matrix): Promise<PMath.Matrix> {
    const rowsA = A.length;
    const colsB = B[0].length;
    const res = await this.matMulF64(
      this.flatten(A),
      this.flatten(B),
      rowsA,
      colsB,
      A[0].length
    );
    return this.unflatten(new Float32Array(res), rowsA, colsB);
  }

  /**
   * Direct Float64-compatible matrix multiplication for the GPU.
   */
  async matMulF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64,
    rowsA: number,
    colsB: number,
    innerDim: number
  ): Promise<PMath.Vector64> {
    if (!TensorMath_GPU.device || !this.matMulPipeline) await this.init();
    const device = TensorMath_GPU.device!;

    const flatA = A instanceof Float64Array ? new Float32Array(A) : A;
    const flatB = B instanceof Float64Array ? new Float32Array(B) : B;
    const sizeC = rowsA * colsB * 4;

    const bufA = device.createBuffer({
      size: flatA.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bufB = device.createBuffer({
      size: flatB.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bufC = device.createBuffer({
      size: sizeC,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const bufParams = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bufRead = device.createBuffer({
      size: sizeC,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    device.queue.writeBuffer(bufA, 0, flatA as GPUAllowSharedBufferSource);
    device.queue.writeBuffer(bufB, 0, flatB as GPUAllowSharedBufferSource);
    device.queue.writeBuffer(
      bufParams,
      0,
      new Float32Array([rowsA, colsB, innerDim, 0])
    );

    const bg = device.createBindGroup({
      layout: this.matMulPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufA } },
        { binding: 1, resource: { buffer: bufB } },
        { binding: 2, resource: { buffer: bufC } },
        { binding: 3, resource: { buffer: bufParams } },
      ],
    });

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.matMulPipeline!);
    passEncoder.setBindGroup(0, bg);
    passEncoder.dispatchWorkgroups(Math.ceil(colsB / 8), Math.ceil(rowsA / 8));
    passEncoder.end();

    commandEncoder.copyBufferToBuffer(bufC, 0, bufRead, 0, sizeC);
    device.queue.submit([commandEncoder.finish()]);

    await bufRead.mapAsync(GPUMapMode.READ);
    const res = new Float32Array(bufRead.getMappedRange().slice(0));
    bufRead.unmap();

    [bufA, bufB, bufC, bufParams, bufRead].forEach(b => b.destroy());
    return new Float64Array(res);
  }

  /**
   * Superimposes two logic fields on the GPU.
   */
  async add(A: PMath.Matrix, B: PMath.Matrix): Promise<PMath.Matrix> {
    const flatA = this.flatten(A);
    const flatB = this.flatten(B);
    const res = await this.addF64(flatA, flatB);
    return this.unflatten(new Float32Array(res), A.length, A[0].length);
  }

  /**
   * Direct Float64-compatible element-wise addition on the GPU.
   */
  async addF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64
  ): Promise<PMath.Vector64> {
    if (!TensorMath_GPU.device || !this.addPipeline) await this.init();
    const flatA = A instanceof Float64Array ? new Float32Array(A) : A;
    const flatB = B instanceof Float64Array ? new Float32Array(B) : B;
    const numElements = flatA.length;
    const res = await this.dispatchElementwise(
      flatA,
      flatB,
      this.addPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      Math.ceil(numElements / 64)
    );
    return new Float64Array(res);
  }

  /**
   * Direct Float64-compatible element-wise scalar multiplication on the GPU.
   */
  async mulScalarF64(
    A: PMath.Vector32_64,
    scalar: number
  ): Promise<PMath.Vector64> {
    if (!TensorMath_GPU.device || !this.mulScalarPipeline) await this.init();
    const flatA = A instanceof Float64Array ? new Float32Array(A) : A;
    const numElements = flatA.length;

    // We reuse dispatchElementwise by passing null for B
    const device = TensorMath_GPU.device!;
    const bufA = device.createBuffer({
      size: flatA.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bufC = device.createBuffer({
      size: numElements * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const bufParams = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bufRead = device.createBuffer({
      size: numElements * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    device.queue.writeBuffer(bufA, 0, flatA);
    const params = new ArrayBuffer(16);
    const view = new DataView(params);
    view.setUint32(0, numElements, true);
    view.setFloat32(4, scalar, true);
    device.queue.writeBuffer(bufParams, 0, params);

    const bg = device.createBindGroup({
      layout: this.mulScalarPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufA } },
        { binding: 1, resource: { buffer: bufC } },
        { binding: 2, resource: { buffer: bufParams } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.mulScalarPipeline!);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(numElements / 64));
    pass.end();

    encoder.copyBufferToBuffer(bufC, 0, bufRead, 0, numElements * 4);
    device.queue.submit([encoder.finish()]);

    await bufRead.mapAsync(GPUMapMode.READ);
    const res = new Float32Array(bufRead.getMappedRange().slice(0));
    bufRead.unmap();

    [bufA, bufC, bufParams, bufRead].forEach(b => b.destroy());
    return new Float64Array(res);
  }

  /**
   * Attenuates negative influences in a logic field on the GPU.
   */
  async relu(A: PMath.Matrix): Promise<PMath.Matrix> {
    if (!TensorMath_GPU.device || !this.reluPipeline) await this.init();
    const flatA = this.flatten(A);
    const numElements = flatA.length;
    const res = await this.dispatchElementwise(
      flatA,
      null,
      this.reluPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      Math.ceil(numElements / 64)
    );
    return this.unflatten(res, A.length, A[0].length);
  }

  /**
   * Attenuates negative influences in a logic vector on the GPU.
   */
  async reluV(A: PMath.Vector): Promise<PMath.Vector> {
    if (!TensorMath_GPU.device || !this.reluPipeline) await this.init();
    const flatA = new Float32Array(A);
    const numElements = flatA.length;
    const res = await this.dispatchElementwise(
      flatA,
      null,
      this.reluPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      Math.ceil(numElements / 64)
    );
    return Array.from(res);
  }

  /**
   * Normalizes logical influence into a probability distribution on the GPU.
   */
  async softmax(vector: PMath.Vector): Promise<PMath.Vector> {
    if (!TensorMath_GPU.device || !this.softmaxPipeline) await this.init();
    const flatA = new Float32Array(vector);
    const numElements = flatA.length;
    const res = await this.dispatchElementwise(
      flatA,
      null,
      this.softmaxPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      1
    );
    return Array.from(res);
  }

  /**
   * Destroys the GPU device and releases all logical pipelines.
   */
  async dispose(): Promise<void> {
    if (TensorMath_GPU.device) {
      TensorMath_GPU.device.destroy();
      TensorMath_GPU.device = null;
    }
    TensorMath_GPU.instance = null;
  }
}

export { TensorMath_CPU, TensorMath_GPU };
