/**
 * Skills layer - the open-ended skill registry for the Mapper.
 *
 * A "skill" is an external behaviour the Mapper can elect to invoke when a
 * query's manifold position is attracted to a capability precept. The
 * registry is just a Map<preceptId, SkillHandler> - the Mapper's potential
 * field decides which one fires.
 */

import type Store from "@core_s/Memory";
import type { IngestResult, Language } from "@skill_lang/Language";

export interface SkillContext {
  /** The raw query text (already perspective-shifted by Language). */
  query: string;
  /** Manifold IDs for the ingested query sequence. */
  queryIds: Uint32Array;
  /** Reference to the live manifold the skill may inspect or extend. */
  system: Root.ManifoldView;
  /** Persistent vault for crystallising new proofs. */
  store: Store;
  /** Atomizer for encoding/decoding sequences. */
  atomizer: Atomic.Engine;
  /** The language boundary for translation and memory. */
  language: Language;
  /** Full result from Language.ingest() - includes isArithmeticQuery, attractionCenter, etc. */
  ingestResult?: IngestResult;
}

export interface SkillResult {
  /** Human-readable answer. */
  answer: string;
  /** Confidence in [0, 1]; used to weight vault crystallisation energy. */
  confidence: number;
}

export type SkillHandler = (ctx: SkillContext) => Promise<SkillResult>;

export interface SkillRegistration {
  /** Manifold ID of the capability precept this skill answers to. */
  preceptId: number;
  handler: SkillHandler;
}

/** Convenience factory for boot-time wiring. */
export function createSkillRegistration(
  preceptId: number,
  handler: SkillHandler
): SkillRegistration {
  return { preceptId, handler };
}
