/**
 * seed.worker - WordNet dictionary lookup in an isolated thread.
 *
 * Performs only the lookup portion of DictionaryExpander.expand().
 * Returns raw definitions and synonyms; the main thread handles DuckDB writes.
 * Isolates en-dictionary's large Map allocations from the main-thread GC.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { parentPort } from "node:worker_threads";

function resolveWordNetPath(): string {
  const req = createRequire(import.meta.url);
  const wnPkg = req.resolve("en-wordnet/package.json");
  return path.join(path.dirname(wnPkg), "database", "3.1");
}

let dict: import("en-dictionary").default | null = null;

async function init(): Promise<void> {
  try {
    const { default: Dictionary } = await import("en-dictionary");
    dict = new Dictionary(resolveWordNetPath());
    await (dict as any).init();
  } catch {
    dict = null;
  }
}

function lookup(word: string): WorkerIPC.SeedResult {
  const result: WorkerIPC.SeedResult = {
    found: false,
    word,
    definitions: [],
    synonyms: [],
  };
  if (!dict) return result;

  const norm = word.toLowerCase().trim().replace(/\s+/g, "_");
  if (norm.length < 2) return result;

  let searchResult: Map<string, Map<string, any>>;
  try {
    searchResult = (dict as any).searchFor([norm]);
  } catch {
    return result;
  }

  const posEntries = searchResult.get(norm);
  if (!posEntries?.size) return result;

  for (const [, entry] of posEntries) {
    for (const data of entry?.offsetData ?? []) {
      const def = data.glossary?.[0]
        ?.replace(/["']/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (def && !result.definitions.includes(def))
        result.definitions.push(def);

      for (const ptr of data.pointers ?? []) {
        if (
          ptr.offset === 0 &&
          typeof ptr.symbol === "string" &&
          /^[a-z][a-z\-_ ]*$/i.test(ptr.symbol) &&
          ptr.symbol.toLowerCase() !== norm
        ) {
          const syn = ptr.symbol.replace(/_/g, " ").toLowerCase();
          if (!result.synonyms.includes(syn)) result.synonyms.push(syn);
        }
      }
    }
  }

  if (result.definitions.length || result.synonyms.length) result.found = true;
  return result;
}

// Initialize WordNet before accepting messages.
init().then(() => {
  parentPort!.on("message", (msg: WorkerIPC.SeedRequest) => {
    const { id, word } = msg;
    try {
      const result = lookup(word);
      parentPort!.postMessage({ id, result });
    } catch (err: any) {
      parentPort!.postMessage({
        id,
        result: { found: false, word, definitions: [], synonyms: [] },
        error: err?.message ?? String(err),
      });
    }
  });

  // Signal readiness to main thread.
  parentPort!.postMessage({ ready: true });
});
