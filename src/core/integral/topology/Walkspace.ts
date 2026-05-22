/**
 * TravelerWorkspace - per-call workspace for Traveler.perceive (was Resolver.resolveSequence).
 *
 * The Traveler's perception engine used to live in Resolver. That engine held
 * scratch buffers, diagnostics, and context/probe flags directly on the
 * instance. That worked when a single caller invoked the engine at a time.
 * Once Runtime started CognitiveLoop, Learner, InquiryQueue.step, dream cycle,
 * gap scanner and user input all sharing the same engine instance, every
 * overlapping call clobbered the other's scratch state.
 *
 * A workspace owns three categories of per-call state:
 *   1. Scratch buffers (T, W, E_total, E_curr, E_new, T_next, T_back,
 *      T_back_next, backwardEnergy, directScopes, resultIds) - written and
 *      then immediately read inside one perceive call.
 *   2. Output state (diagnostics, sinkStrength, discoveredOperators) - written
 *      at the end of perceive and read by the caller after await.
 *   3. Input state (contextScopes, probeMode) - passed in by the caller and
 *      read during the call.
 *
 * One workspace per concurrent call. The pool hands out workspaces and
 * reclaims them on release. When the pool is exhausted, acquire() awaits
 * the next release.
 */

import { RingBuffer } from "ring-buffer-ts";

/** A pre-allocated workspace for one in-flight Traveler.perceive call. */
export class TravelerWorkspace {
  // Scratch buffers (sized at construction; subarray-viewed per call).
  readonly T_buffer: Float64Array;
  readonly W_buffer: Float64Array;
  readonly E_total_buffer: Float64Array;
  readonly E_curr_buffer: Float64Array;
  readonly E_new_buffer: Float64Array;
  readonly T_next_buffer: Float64Array;
  readonly T_back_buffer: Float64Array;
  readonly T_back_next_buffer: Float64Array;
  readonly backwardEnergyBuffer: Float64Array;
  readonly directScopesBuffer: Float64Array;
  readonly resultIdsBuffer: Uint32Array;

  // Per-call outputs.
  diagnostics: Mapping.PerceptionDiagnostics | null = null;
  sinkStrength = 0;
  discoveredOperators: Mapping.DiscoveredOperator[] = [];
  bridgeCandidates: Mapping.BridgeCandidate[] = [];

  // Per-call inputs.
  contextScopes: Set<number> = new Set();
  probeMode = false;

  constructor(maxN: number) {
    this.T_buffer = new Float64Array(maxN);
    this.W_buffer = new Float64Array(maxN * maxN);
    this.E_total_buffer = new Float64Array(maxN * maxN);
    this.E_curr_buffer = new Float64Array(maxN * maxN);
    this.E_new_buffer = new Float64Array(maxN * maxN);
    this.T_next_buffer = new Float64Array(maxN);
    this.T_back_buffer = new Float64Array(maxN);
    this.T_back_next_buffer = new Float64Array(maxN);
    this.backwardEnergyBuffer = new Float64Array(maxN);
    this.directScopesBuffer = new Float64Array(maxN);
    this.resultIdsBuffer = new Uint32Array(maxN);
  }

  /** Clear per-call state so the workspace is safe to hand out again. */
  reset(): void {
    this.diagnostics = null;
    this.sinkStrength = 0;
    this.discoveredOperators = [];
    this.bridgeCandidates = [];
    this.contextScopes = new Set();
    this.probeMode = false;
  }
}

/** Backward-compat aliases. */
export const MapperWorkspace = TravelerWorkspace;
export type MapperWorkspace = TravelerWorkspace;
export const ResolverSlot = TravelerWorkspace;
export type ResolverSlot = TravelerWorkspace;

/**
 * Fixed-capacity pool of TravelerWorkspaces backed by a RingBuffer free-list.
 *
 * Capacity sets the maximum concurrent perceive calls. Beyond that,
 * acquire() awaits until a workspace is released. Capacity should match the
 * Runtime's concurrent producer count plus a small headroom (the default of 8
 * covers user input + CognitiveLoop + Learner.runCycle(5) + InquiryQueue +
 * gap scanner + dream cycle without ever blocking).
 */
export class TravelerWorkspacePool {
  private readonly free: RingBuffer<TravelerWorkspace>;
  private readonly waiters: Array<(slot: TravelerWorkspace) => void> = [];
  private readonly capacity: number;

  constructor(capacity: number, maxN: number) {
    this.capacity = capacity;
    this.free = new RingBuffer<TravelerWorkspace>(capacity);
    for (let i = 0; i < capacity; i++) {
      this.free.add(new TravelerWorkspace(maxN));
    }
  }

  /**
   * Acquire a workspace. Resolves immediately when one is free; otherwise
   * queues the caller until a workspace is released.
   */
  acquire(): Promise<TravelerWorkspace> {
    if (!this.free.isEmpty()) {
      return Promise.resolve(this.free.removeFirst());
    }
    return new Promise<TravelerWorkspace>(resolve =>
      this.waiters.push(resolve)
    );
  }

  /** Return a workspace to the pool, handing it to the next waiter if any. */
  release(slot: TravelerWorkspace): void {
    slot.reset();
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(slot);
    } else {
      this.free.add(slot);
    }
  }

  /** Number of workspaces currently free (not checked out). */
  get available(): number {
    return this.free.getBufferLength();
  }

  /** Number of callers currently awaiting a workspace. */
  get pending(): number {
    return this.waiters.length;
  }

  /** Pool capacity (max concurrent calls). */
  get size(): number {
    return this.capacity;
  }
}

/** Backward-compat aliases. */
export const MapperWorkspacePool = TravelerWorkspacePool;
export type MapperWorkspacePool = TravelerWorkspacePool;
export const ResolverSlotPool = TravelerWorkspacePool;
export type ResolverSlotPool = TravelerWorkspacePool;
