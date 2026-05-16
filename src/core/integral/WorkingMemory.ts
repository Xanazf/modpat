/**
 * WorkingMemory - short-term conversational context across turns.
 *
 * Records each resolved conclusion so subsequent turns can:
 *   1. Resolve pronouns ("it", "this" → last conclusion)
 *   2. Seed the Resolver's forward pass with recently active concepts
 *   3. Build on established ground rather than starting from zero each time
 *
 * The frame limit (default 8) keeps memory bounded and aligned with the
 * manifold's own thermodynamic forgetting (old precepts decay in mass).
 */

import type { BridgeCandidate } from "@core_i/Resolver";

export interface MemoryFrame {
  query: string;
  conclusion: string; // decoded result text
  conclusionScope: number; // scope of the primary conclusion atom
  conclusionId: number; // manifold ID of the primary conclusion
  explanation: string | null; // terse inferential chain ("A → B → conclusion")
  turn: number;
}

const REFERENCE_PRONOUNS =
  /\b(it|this|that|they|them|those|these|its|their)\b/gi;

export class WorkingMemory {
  private frames: MemoryFrame[] = [];
  private _turn = 0;

  constructor(private readonly maxFrames: number = 8) {}

  get turn(): number {
    return this._turn;
  }
  get size(): number {
    return this.frames.length;
  }

  push(frame: Omit<MemoryFrame, "turn">): void {
    this._turn++;
    this.frames.push({ ...frame, turn: this._turn });
    if (this.frames.length > this.maxFrames) this.frames.shift();
  }

  recent(n = 3): MemoryFrame[] {
    return this.frames.slice(-n);
  }

  /**
   * Returns the manifold IDs of recent conclusions for Resolver context seeding.
   * The Resolver gives bonus initial energy to any token in the new query whose
   * scope matches a recently-established conclusion.
   */
  contextSeeds(): number[] {
    return this.frames.map(f => f.conclusionId).filter(id => id > 0);
  }

  /**
   * Returns the scopes of recent conclusions - used for scope-based matching
   * when the exact precept ID may differ between turns.
   */
  contextScopes(): number[] {
    return this.frames.map(f => f.conclusionScope).filter(s => s > 0);
  }

  /**
   * Replaces reference pronouns in the query with the most recently established
   * concept. "What does it do?" → "What does [last conclusion] do?"
   *
   * Only fires when the last conclusion is non-trivial (not "unknown").
   */
  resolveReferences(query: string): string {
    REFERENCE_PRONOUNS.lastIndex = 0;
    if (!REFERENCE_PRONOUNS.test(query)) return query;
    REFERENCE_PRONOUNS.lastIndex = 0;
    const last = this.frames[this.frames.length - 1];
    if (!last?.conclusion || last.conclusion === "unknown") return query;
    return query.replace(REFERENCE_PRONOUNS, last.conclusion);
  }

  clear(): void {
    this.frames = [];
  }
}

/**
 * Builds a terse natural-language explanation of the inferential path from the
 * bridge candidates produced by the bidirectional resonance pass.
 *
 * Filters to confirmed bridges (both forward AND backward energy present,
 * not just missing links), sorts them by their position in the query sequence,
 * and formats as "A → B → conclusion".
 *
 * Returns null when the inference was a direct recall with no interesting chain.
 */
export function buildExplanation(
  bridgeCandidates: BridgeCandidate[],
  conclusion: string
): string | null {
  const chain = bridgeCandidates
    .filter(b => !b.isMissingLink && b.bridgeScore > 0.05)
    .sort((a, b) => a.idx - b.idx);

  if (chain.length === 0) return null;

  // Deduplicate adjacent identical labels
  const labels: string[] = [];
  for (const b of chain) {
    if (labels[labels.length - 1] !== b.label) labels.push(b.label);
  }

  // Append the conclusion if not already the last element
  const conclusionNorm = conclusion.toLowerCase().trim();
  if (labels[labels.length - 1]?.toLowerCase() !== conclusionNorm) {
    labels.push(conclusion);
  }

  return labels.length > 1 ? labels.join(" → ") : null;
}
