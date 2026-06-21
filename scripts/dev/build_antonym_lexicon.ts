/**
 * build_antonym_lexicon.ts - extract WordNet lexical antonym pairs into a compact
 * JSON asset (`src/core/structural/atomizers/antonyms.json`) consumed by
 * AntonymLexicon at runtime.
 *
 * Antonymy in WordNet is a LEXICAL relation (word-to-word, not synset-to-synset),
 * encoded by the `!` pointer in the data.* files. Each such pointer carries a
 * source/target field whose two byte-pairs index the specific word in the source
 * synset and the specific word in the target synset - so "hot" antonyms "cold",
 * not the whole temperature synset. We resolve both endpoints and emit the
 * undirected pair. Antonyms are same-POS, so the target synset is always in the
 * same data file (one offset->words index per file suffices).
 *
 * Run once (or whenever en-wordnet updates):  tsx scripts/dev/build_antonym_lexicon.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
// en-wordnet ships the raw Princeton DB files; its exported path map hard-codes
// the author's machine, so we resolve the package directory ourselves.
const DB = join(ROOT, "node_modules", "en-wordnet", "database", "3.1");
// Committed alongside its loader (small, deterministic from the en-wordnet dep) -
// data/ is gitignored for the large GloVe/UMAP binaries, but this asset must ship
// so the feature is not silently inert on a fresh checkout.
const OUT = join(
  ROOT,
  "src",
  "core",
  "structural",
  "atomizers",
  "antonyms.json"
);

// Adjective / adverb / verb antonyms only - these are the CONTRARY oppositions
// step 9 wants antipodal (hot/cold, true/false, up/down, increase/decrease). NOUN
// antonyms in WordNet are overwhelmingly RELATIONAL pairs (king/queen, man/woman,
// boy/girl) - gendered co-hyponyms that are semantically CLOSE, not contradictory;
// placing them antipodally is wrong (it breaks king≈queen) and is not the logical
// opposition the wave channel reads. So data.noun is deliberately excluded.
const POS_FILES = ["data.adj", "data.adv", "data.verb"];

interface Synset {
  words: string[];
  /** antonym pointers as (srcWordIdx 1-based, targetOffset, tgtWordIdx 1-based) */
  antonyms: { src: number; offset: number; tgt: number }[];
}

/** A WordNet word lemma: lowercase, underscores -> spaces, parenthetical sense marker stripped. */
function normWord(w: string): string {
  return w
    .replace(/\(.*\)$/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

function parseFile(path: string): Map<number, Synset> {
  const text = readFileSync(path, "utf8");
  const synsets = new Map<number, Synset>();
  for (const line of text.split("\n")) {
    // Skip the copyright header (lines begin with two spaces) and blanks.
    if (line.length === 0 || line.startsWith("  ")) continue;
    const t = line.split(" ");
    let k = 0;
    const offset = Number.parseInt(t[k++], 10);
    k++; // lex_filenum
    k++; // ss_type
    const wCnt = Number.parseInt(t[k++], 16);
    const words: string[] = [];
    for (let i = 0; i < wCnt; i++) {
      words.push(t[k++]); // word
      k++; // lex_id (hex)
    }
    const pCnt = Number.parseInt(t[k++], 10);
    const antonyms: Synset["antonyms"] = [];
    for (let i = 0; i < pCnt; i++) {
      const sym = t[k++];
      const off = Number.parseInt(t[k++], 10);
      k++; // pos
      const st = t[k++]; // 4-hex source/target
      if (sym === "!") {
        const src = Number.parseInt(st.slice(0, 2), 16);
        const tgt = Number.parseInt(st.slice(2, 4), 16);
        antonyms.push({ src, offset: off, tgt });
      }
    }
    synsets.set(offset, { words, antonyms });
  }
  return synsets;
}

const pairs = new Map<string, Set<string>>();
const add = (a: string, b: string) => {
  if (!a || !b || a === b) return;
  (pairs.get(a) ?? pairs.set(a, new Set()).get(a)!).add(b);
  (pairs.get(b) ?? pairs.set(b, new Set()).get(b)!).add(a);
};

let pointerCount = 0;
for (const f of POS_FILES) {
  const synsets = parseFile(join(DB, f));
  for (const syn of synsets.values()) {
    for (const ant of syn.antonyms) {
      const srcWord = syn.words[ant.src - 1];
      const tgtSyn = synsets.get(ant.offset);
      const tgtWord = tgtSyn?.words[ant.tgt - 1];
      if (!srcWord || !tgtWord) continue;
      pointerCount++;
      add(normWord(srcWord), normWord(tgtWord));
    }
  }
}

// Serialize as a sorted plain object word -> sorted antonym list (stable diffs).
const obj: Record<string, string[]> = {};
for (const w of [...pairs.keys()].sort()) {
  obj[w] = [...pairs.get(w)!].sort();
}
writeFileSync(OUT, `${JSON.stringify(obj, null, 0)}\n`);

console.log(`parsed ${pointerCount} antonym pointers`);
console.log(`wrote ${Object.keys(obj).length} lemmas -> ${OUT}`);
for (const probe of ["hot", "true", "fire", "good", "up", "increase"]) {
  console.log(`  ${probe} ->`, obj[probe] ?? "(none)");
}
