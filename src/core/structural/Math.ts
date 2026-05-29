/// <reference types="@webgpu/types" />
import gpu from "@kmamal/gpu";
import { mat3d, mat4d, vec2d, vec3d, vec4d } from "wgpu-matrix";

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

// Private GPU State Variables in Module Scope
let gpuDevice: GPUDevice | null = null;
let gpuInstance: GPU | null = null;
let matMulPipeline: GPUComputePipeline | null = null;
let addPipeline: GPUComputePipeline | null = null;
let mulScalarPipeline: GPUComputePipeline | null = null;
let reluPipeline: GPUComputePipeline | null = null;
let softmaxPipeline: GPUComputePipeline | null = null;

// Helpers

function flatten(matrix: PMath.Matrix): Float32Array {
  return new Float32Array(matrix.flat());
}

function unflatten(
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

async function initPipelines() {
  const device = gpuDevice!;

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
  matMulPipeline = device.createComputePipeline({
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
  addPipeline = device.createComputePipeline({
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
  mulScalarPipeline = device.createComputePipeline({
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
  reluPipeline = device.createComputePipeline({
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
  softmaxPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: softmaxShader, entryPoint: "main" },
  });
}

async function dispatchElementwise(
  A: Float32Array,
  B: Float32Array | null,
  pipeline: GPUComputePipeline,
  sizeC: number,
  paramsArray: Uint32Array,
  workgroups: number
): Promise<Float32Array> {
  const device = gpuDevice!;

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

// Engines

const cpu_math: PMath.Engine = {
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
  },

  async matMulF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64,
    rowsA: number,
    colsB: number,
    innerDim: number
  ): Promise<PMath.Vector64> {
    const res = new Float64Array(rowsA * colsB);

    if (rowsA === 4 && colsB === 4 && innerDim === 4) {
      mat4d.multiply(B, A, res);
      return res;
    }
    if (rowsA === 3 && colsB === 3 && innerDim === 3) {
      mat3d.multiply(B, A, res);
      return res;
    }

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
  },

  async add(A: PMath.Matrix, B: PMath.Matrix): Promise<PMath.Matrix> {
    return A.map((row, i) => row.map((val, j) => val + B[i][j]));
  },

  async addF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64
  ): Promise<PMath.Vector64> {
    const res = new Float64Array(A.length);
    if (A.length === 4) {
      vec4d.add(A, B, res);
      return res;
    }
    if (A.length === 3) {
      vec3d.add(A, B, res);
      return res;
    }
    if (A.length === 2) {
      vec2d.add(A, B, res);
      return res;
    }
    for (let i = 0; i < A.length; i++) {
      res[i] = A[i] + B[i];
    }
    return res;
  },

  async mulScalarF64(
    A: PMath.Vector32_64,
    scalar: number
  ): Promise<PMath.Vector64> {
    const res = new Float64Array(A.length);
    if (A.length === 4) {
      vec4d.scale(A, scalar, res);
      return res;
    }
    if (A.length === 3) {
      vec3d.scale(A, scalar, res);
      return res;
    }
    if (A.length === 2) {
      vec2d.scale(A, scalar, res);
      return res;
    }
    for (let i = 0; i < A.length; i++) {
      res[i] = A[i] * scalar;
    }
    return res;
  },

  async relu(A: PMath.Matrix): Promise<PMath.Matrix> {
    return A.map(row => row.map(val => Math.max(0, val)));
  },

  async reluV(A: PMath.Vector): Promise<PMath.Vector> {
    return A.map(v => Math.max(0, v));
  },

  async softmax(vector: PMath.Vector): Promise<PMath.Vector> {
    const exp = vector.map(v => Math.exp(v));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  },

  async dispose(): Promise<void> {},
};

const gpu_math: PMath.Engine & {
  getDevice(): Promise<GPUDevice>;
  init(): Promise<void>;
} = {
  async getDevice(): Promise<GPUDevice> {
    if (gpuDevice) return gpuDevice;

    let gpuImpl: GPU | undefined;
    if (typeof navigator !== "undefined" && navigator.gpu) {
      gpuImpl = navigator.gpu;
    } else {
      if (!gpuInstance) {
        //@ts-expect-error: - FIX YOUR SHIT MAMMAL
        gpuInstance = gpu.create([]);
      }
      gpuImpl = gpuInstance as unknown as GPU;
    }

    if (!gpuImpl) throw new Error("WebGPU not supported.");
    const adapter = await gpuImpl.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("No GPU found.");
    gpuDevice = await adapter.requestDevice();
    return gpuDevice;
  },

  async init() {
    if (!gpuDevice) {
      gpuDevice = await this.getDevice();
    }
    if (!matMulPipeline) {
      await initPipelines();
    }
  },

  async matMul(A: PMath.Matrix, B: PMath.Matrix): Promise<PMath.Matrix> {
    const rowsA = A.length;
    const colsB = B[0].length;
    const res = await this.matMulF64(
      flatten(A),
      flatten(B),
      rowsA,
      colsB,
      A[0].length
    );
    return unflatten(new Float32Array(res), rowsA, colsB);
  },

  async matMulF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64,
    rowsA: number,
    colsB: number,
    innerDim: number
  ): Promise<PMath.Vector64> {
    if (!gpuDevice || !matMulPipeline) await this.init();
    const device = gpuDevice!;

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
      layout: matMulPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufA } },
        { binding: 1, resource: { buffer: bufB } },
        { binding: 2, resource: { buffer: bufC } },
        { binding: 3, resource: { buffer: bufParams } },
      ],
    });

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(matMulPipeline!);
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
  },

  async add(A: PMath.Matrix, B: PMath.Matrix): Promise<PMath.Matrix> {
    const flatA = flatten(A);
    const flatB = flatten(B);
    const res = await this.addF64(flatA, flatB);
    return unflatten(new Float32Array(res), A.length, A[0].length);
  },

  async addF64(
    A: PMath.Vector32_64,
    B: PMath.Vector32_64
  ): Promise<PMath.Vector64> {
    if (!gpuDevice || !addPipeline) await this.init();
    const flatA = A instanceof Float64Array ? new Float32Array(A) : A;
    const flatB = B instanceof Float64Array ? new Float32Array(B) : B;
    const numElements = flatA.length;
    const res = await dispatchElementwise(
      flatA,
      flatB,
      addPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      Math.ceil(numElements / 64)
    );
    return new Float64Array(res);
  },

  async mulScalarF64(
    A: PMath.Vector32_64,
    scalar: number
  ): Promise<PMath.Vector64> {
    if (!gpuDevice || !mulScalarPipeline) await this.init();
    const flatA = A instanceof Float64Array ? new Float32Array(A) : A;
    const numElements = flatA.length;

    const device = gpuDevice!;
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
      layout: mulScalarPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufA } },
        { binding: 1, resource: { buffer: bufC } },
        { binding: 2, resource: { buffer: bufParams } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(mulScalarPipeline!);
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
  },

  async relu(A: PMath.Matrix): Promise<PMath.Matrix> {
    if (!gpuDevice || !reluPipeline) await this.init();
    const flatA = flatten(A);
    const numElements = flatA.length;
    const res = await dispatchElementwise(
      flatA,
      null,
      reluPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      Math.ceil(numElements / 64)
    );
    return unflatten(res, A.length, A[0].length);
  },

  async reluV(A: PMath.Vector): Promise<PMath.Vector> {
    if (!gpuDevice || !reluPipeline) await this.init();
    const flatA = new Float32Array(A);
    const numElements = flatA.length;
    const res = await dispatchElementwise(
      flatA,
      null,
      reluPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      Math.ceil(numElements / 64)
    );
    return Array.from(res);
  },

  async softmax(vector: PMath.Vector): Promise<PMath.Vector> {
    if (!gpuDevice || !softmaxPipeline) await this.init();
    const flatA = new Float32Array(vector);
    const numElements = flatA.length;
    const res = await dispatchElementwise(
      flatA,
      null,
      softmaxPipeline!,
      numElements * 4,
      new Uint32Array([numElements, 0, 0, 0]),
      1
    );
    return Array.from(res);
  },

  async dispose(): Promise<void> {
    if (gpuDevice) {
      gpuDevice.destroy();
      gpuDevice = null;
    }
    gpuInstance = null;
  },
};

// Vectorized Math Helper Functions

export function distance4DPoints(
  x1: number,
  y1: number,
  z1: number,
  w1: number,
  x2: number,
  y2: number,
  z2: number,
  w2: number
): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const dz = z1 - z2;
  const dw = w1 - w2;
  return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
}

export function windingNumber2D(
  loop: [number, number][],
  gx: number,
  gy: number
): number {
  let wn = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % n];
    if (y1 <= gy) {
      if (y2 > gy) {
        if ((x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) > 0) {
          wn++;
        }
      }
    } else {
      if (y2 <= gy) {
        if ((x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) < 0) {
          wn--;
        }
      }
    }
  }
  return wn;
}

export function multiplyMatrices4x4(
  A: Float64Array,
  B: Float64Array
): Float64Array {
  const C = new Float64Array(16);
  mat4d.multiply(B, A, C);
  return C;
}

export function transposeMatrix4x4(M: Float64Array): Float64Array {
  const T = new Float64Array(16);
  mat4d.transpose(M, T);
  return T;
}

export function identity4x4(): Float64Array {
  const I = new Float64Array(16);
  mat4d.identity(I);
  return I;
}

export function computeHolonomy(
  px: Float64Array,
  py: Float64Array,
  pe: Float64Array,
  pa: Float64Array,
  steps: number,
  outHolonomy: Float64Array
): number {
  mat4d.identity(outHolonomy);
  const u = vec4d.create();
  const v = vec4d.create();
  const uHat = vec4d.create();
  const vHat = vec4d.create();
  const p = vec4d.create();
  const R = mat4d.create();

  for (let i = 1; i < steps; i++) {
    u[0] = px[i] - px[i - 1];
    u[1] = py[i] - py[i - 1];
    u[2] = pe[i] - pe[i - 1];
    u[3] = pa[i] - pa[i - 1];

    v[0] = px[i + 1] - px[i];
    v[1] = py[i + 1] - py[i];
    v[2] = pe[i + 1] - pe[i];
    v[3] = pa[i + 1] - pa[i];

    const uMag = vec4d.length(u) + 1e-12;
    const vMag = vec4d.length(v) + 1e-12;

    vec4d.scale(u, 1 / uMag, uHat);
    vec4d.scale(v, 1 / vMag, vHat);

    const cosT = Math.max(-1, Math.min(1, vec4d.dot(uHat, vHat)));
    if (Math.abs(cosT) > 1 - 1e-10) continue;

    const sinT = Math.sqrt(1 - cosT * cosT);

    vec4d.scale(uHat, -cosT, p);
    vec4d.add(vHat, p, p);
    vec4d.scale(p, 1 / sinT, p);

    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        R[a * 4 + b] =
          (a === b ? 1 : 0) +
          sinT * (p[a] * uHat[b] - uHat[a] * p[b]) +
          (cosT - 1) * (uHat[a] * uHat[b] + p[a] * p[b]);
      }
    }

    mat4d.multiply(outHolonomy, R, outHolonomy);
  }

  let frobSq = 0;
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      const d = outHolonomy[a * 4 + b] - (a === b ? 1 : 0);
      frobSq += d * d;
    }
  }
  return Math.sqrt(frobSq) / 4;
}

export function computeChristoffelForce(
  v: ArrayLike<number>,
  dG: Float64Array,
  outForce: Float64Array
): void {
  outForce.fill(0);
  const t = vec4d.create();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      t[j] = vec4d.dot(dG.subarray(i * 16 + j * 4, i * 16 + j * 4 + 4), v);
    }
    outForce[i] = vec4d.dot(v, t);
  }
}

export function updateChristoffels(
  v: ArrayLike<number>,
  delta: number,
  dG: Float64Array
): void {
  const vVec = vec4d.create();
  vVec[0] = v[0];
  vVec[1] = v[1];
  vVec[2] = v[2];
  vVec[3] = v[3];
  const temp = vec4d.create();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const factor = delta * v[i] * v[j];
      const base = i * 16 + j * 4;
      vec4d.scale(vVec, factor, temp);
      const sub = dG.subarray(base, base + 4);
      vec4d.add(sub, temp, sub);
    }
  }
}

export function regularizeChristoffels(
  dG: Float64Array,
  regularization: number
): void {
  const decay = 1 - regularization;
  for (let i = 0; i < 64; i++) {
    dG[i] *= decay;
  }
}

export { cpu_math, gpu_math };
