/**
 * ast.worker - TypeScript/JavaScript AST parsing in an isolated thread.
 *
 * Reads source files from disk and calls extractAstTriples().
 * Heavy allocations from the TypeScript compiler API stay off the main-thread GC.
 * Returns AstTriple[] to the main thread; no DuckDB, no manifold writes.
 */

import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import {
  extractAstTriples,
  type AstTriple,
  type AstExtractOptions,
} from "@utils/astExtract";

interface AstRequest {
  id: number;
  filePath: string;
  opts: AstExtractOptions;
}

interface AstResponse {
  id: number;
  triples?: AstTriple[];
  error?: string;
}

parentPort!.on("message", (msg: AstRequest) => {
  const { id, filePath, opts } = msg;
  try {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const triples = extractAstTriples(sourceText, filePath, opts);
    parentPort!.postMessage({ id, triples } satisfies AstResponse);
  } catch (err: any) {
    parentPort!.postMessage({
      id,
      triples: [],
      error: err?.message ?? String(err),
    } satisfies AstResponse);
  }
});

// Signal readiness immediately - no async init needed.
parentPort!.postMessage({ ready: true });
