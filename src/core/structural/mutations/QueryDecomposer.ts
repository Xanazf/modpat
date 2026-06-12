export interface SubQuery {
  text: string;
  purpose: string;
}

// True function words excluded from BOTH entity and predicate extraction
const FUNCTION_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "with",
  "how",
  "what",
  "who",
  "where",
  "when",
  "why",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "can",
  "could",
  "would",
  "should",
  "will",
  "may",
]);

// Common action verbs excluded from ENTITY extraction only (they can still
// appear as predicates in "how to VERB …?" sub-queries)
const ENTITY_SKIP_VERBS = new Set([
  "make",
  "making",
  "do",
  "does",
  "did",
  "use",
  "get",
  "have",
  "create",
  "build",
  "form",
  "produce",
  "generate",
]);

/**
 * Decomposes a compound query into its knowledge prerequisites.
 *
 * Driving question: "what does the Traveler need to know in order to answer
 * this query?"  Entity lookups (what is X?) are generated for each distinct
 * noun; a process lookup (how to V N?) is generated when the query has an
 * action-oriented predicate.  Sub-queries that would duplicate the original
 * query are excluded.
 *
 * The caller (Traveler._resolveSubQuery) is responsible for checking whether
 * each prerequisite is already known before invoking the Unfolder.
 */
export class QueryDecomposer {
  /**
   * Returns true when the query likely requires knowledge of multiple distinct
   * topics - i.e. it has two or more resolvable prerequisite entities and is
   * phrased as a question.
   */
  isCompound(ingestResult: Discourse.IngestResult): boolean {
    if (ingestResult.intent !== "question") return false;
    const predicate = this._predicate(
      ingestResult.topologicalQuery || ingestResult.shifted
    );
    const entities = this._entities(ingestResult.heatNodes, predicate);
    return entities.length >= 2;
  }

  /**
   * Generates sub-queries representing the knowledge prerequisites for
   * `query`.  Returns entity lookups first (dependency order), then a
   * process lookup last.
   */
  decompose(query: string, ingestResult: Discourse.IngestResult): SubQuery[] {
    const predicate = this._predicate(query);
    const entities = this._entities(ingestResult.heatNodes, predicate);
    if (entities.length < 2) return [];

    const subQueries: SubQuery[] = [];
    const queryNorm = this._norm(query);

    // Entity prerequisites: "what is X?" for each noun
    for (const entity of entities) {
      const text = `what is ${entity}?`;
      if (this._overlap(this._norm(text), queryNorm) < 0.75) {
        subQueries.push({ text, purpose: `understand_entity:${entity}` });
      }
    }

    // Process prerequisite: "how to VERB NOUN?" using the last (most general)
    // entity as the anchor so we don't duplicate the original compound query.
    if (predicate && entities.length > 0) {
      const anchor = entities[entities.length - 1];
      const text = `how to ${predicate} ${anchor}?`;
      if (this._overlap(this._norm(text), queryNorm) < 0.75) {
        subQueries.push({ text, purpose: `understand_process:${predicate}` });
      }
    }

    return subQueries;
  }

  // ---- Private helpers ------------------------------------------------------

  /**
   * Extract distinct noun entities from heat nodes, excluding function words,
   * common action verbs, and the extracted predicate verb.
   */
  private _entities(heatNodes: string[], predicate: string | null): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const node of heatNodes) {
      const n = node.toLowerCase();
      if (
        !FUNCTION_WORDS.has(n) &&
        !ENTITY_SKIP_VERBS.has(n) &&
        n.length >= 3 &&
        !/^\d/.test(n) &&
        n !== predicate &&
        !seen.has(n)
      ) {
        seen.add(n);
        result.push(n);
      }
    }
    return result;
  }

  /** Extract action predicate verb from "how to VERB" / "how do you VERB" patterns. */
  private _predicate(query: string): string | null {
    const m = query.match(/\bhow\s+(?:do\s+(?:you|i)\s+)?(?:to\s+)?(\w+)/i);
    if (!m) return null;
    const verb = m[1].toLowerCase();
    return FUNCTION_WORDS.has(verb) ? null : verb;
  }

  /** Normalise a string for overlap comparison. */
  private _norm(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .trim();
  }

  /** Word-level Jaccard overlap between two normalised strings. */
  private _overlap(a: string, b: string): number {
    const wa = new Set(a.split(/\s+/).filter(Boolean));
    const wb = new Set(b.split(/\s+/).filter(Boolean));
    let intersection = 0;
    for (const w of wa) if (wb.has(w)) intersection++;
    const union = new Set([...wa, ...wb]).size;
    return union === 0 ? 0 : intersection / union;
  }
}

export default QueryDecomposer;
