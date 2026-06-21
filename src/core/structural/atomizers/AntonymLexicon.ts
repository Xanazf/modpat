/**
 * AntonymLexicon - lexical opposition pairs from WordNet (`antonyms.json`,
 * co-located here, built by scripts/dev/build_antonym_lexicon.ts).
 *
 * This is the antonym SOURCE for the base atomizer's stance primitive: where
 * syntactic negation ("not X") is triggered by a token, LEXICAL antonyms
 * ("hot"/"cold", "true"/"false") carry the same opposition with no "not" present.
 * Feeding them to the stance step places opposites antipodally at ingestion -
 * exactly as syntactic negation already is - so opposed concepts sit on opposite
 * manifold halves and the WaveResolver reads "hot and cold" as a contradiction
 * with no "not" token. (Roadmap intermediate step 9.)
 *
 * The lexicon is a process-wide singleton loaded lazily on first lookup; the JSON
 * asset is small (~6.6k lemmas) so the parse is negligible and there is no async
 * surface. Lookups are normalized to lowercase/trimmed lemmas, matching the
 * scope-key normalization in BaseAtomizer.getSymbolScope.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET = join(dirname(fileURLToPath(import.meta.url)), "antonyms.json");

let table: Map<string, string[]> | null = null;

function load(): Map<string, string[]> {
  if (table) return table;
  const m = new Map<string, string[]>();
  try {
    const obj = JSON.parse(readFileSync(ASSET, "utf8")) as Record<
      string,
      string[]
    >;
    for (const [word, ants] of Object.entries(obj)) m.set(word, ants);
  } catch {
    // No asset (e.g. en-wordnet not built): lexical stance is simply inert, the
    // syntactic-negation stance is unaffected. Never throws into ingestion.
  }
  table = m;
  return table;
}

const norm = (w: string): string => w.toLowerCase().trim();

/** The lexical antonyms of `word`, or an empty array when none are known. */
export function antonymsOf(word: string): string[] {
  return load().get(norm(word)) ?? [];
}

/** True when `a` and `b` are a known lexical antonym pair (order-independent). */
export function areAntonyms(a: string, b: string): boolean {
  const list = load().get(norm(a));
  return list ? list.includes(norm(b)) : false;
}
