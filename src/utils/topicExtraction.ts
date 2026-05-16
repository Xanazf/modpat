import nlp from "compromise";

export const STOP_WORDS = new Set([
  // Question words (from Runtime)
  "what",
  "who",
  "where",
  "when",
  "why",
  "how",
  // Copulas / modals (union of Runtime + Learner sets)
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "can",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "do",
  "does",
  "did",
  "has",
  "had",
  "have",
  // Articles / determiners
  "a",
  "an",
  "the",
  // Pronouns
  "it",
  "its",
  "this",
  "that",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "our",
  // Conjunctions / prepositions
  "and",
  "but",
  "or",
  "not",
  "all",
  "for",
  "in",
  "of",
  "to",
  "with",
  "from",
  "then",
  "than",
]);

/**
 * Extracts the most semantically significant topic token from a query.
 *
 * Prefers the predicate / object side of an "X is Y" assertion (O4) over
 * the generic longest-non-stop-word fallback, so "Fire is hot" → "hot" and
 * "The sky is blue" → "blue" rather than "sky" or "fire".
 */
export function extractTopic(query: string): string {
  const cleaned = query.replace(/[?!|]+$/, "").trim();

  // NLP predicate preference: adjective or last noun phrase after copula
  const doc = nlp(cleaned);
  const adj = doc.match("#Adjective").out("text").trim();
  if (adj) return adj.toLowerCase();
  const noun = doc.match("#Noun+").last().out("text").trim();
  if (noun && !STOP_WORDS.has(noun.toLowerCase())) return noun.toLowerCase();

  // Fallback: longest non-stop-word token
  const tokens = cleaned
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
  return tokens.sort((a, b) => b.length - a.length)[0] ?? "";
}
