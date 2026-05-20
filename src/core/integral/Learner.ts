/**
 * Learner - DEPRECATED.  Phase 3 of the "Mapper as Thinker" refactor folded
 * the autonomous learning cycle into the Mapper itself.  This file remains as
 * a back-compat shim so existing imports keep compiling.  New callers should
 * use `Mapper.learnCycle()` / `Mapper.challenge()` directly.
 *
 * `InquiryQueue` was moved into its own module (`./InquiryQueue`).
 */

import type Mapper from "./Mapper";

export type { InquiryStatus, InquiryItem } from "./InquiryQueue";
export { InquiryQueue, default as InquiryQueueDefault } from "./InquiryQueue";

/**
 * Thin back-compat wrapper.  Forwards `challenge` and `runCycle` to the
 * provided Mapper instance.  The legacy constructor signature is preserved so
 * tests built against (system, atomizer, mapper, store, unfolder) keep
 * compiling - all parameters except the Mapper are ignored because the Mapper
 * already holds the same references internally.
 */
export class Learner {
  constructor(
    _system: unknown,
    _atomizer: unknown,
    private readonly mapper: Mapper,
    _store?: unknown,
    _unfolder?: unknown
  ) {}

  public challenge(
    candidate: Memory.ChallengeCandidate
  ): Promise<Memory.ChallengeResult> {
    return this.mapper.challenge(candidate);
  }

  public runCycle(batchSize: number = 10): Promise<Memory.ValidationReport> {
    return this.mapper.learnCycle(batchSize);
  }
}

export default Learner;
