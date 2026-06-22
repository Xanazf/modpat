/**
 * ast.worker - TypeScript/JavaScript AST parsing in an isolated thread.
 *
 * Reads source files from disk and calls extractAstTriples().
 * Heavy allocations from the TypeScript compiler API stay off the main-thread GC.
 * Returns AstTriple[] to the main thread; no DuckDB, no manifold writes.
 */

import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { extractAstTriples } from "@utils/astExtract";

parentPort!.on("message", (msg: WorkerIPC.AstRequest) => {
  const { id, filePath, opts } = msg;
  try {
    const sourceText = fs.readFileSync(filePath, "utf8");
    const triples = extractAstTriples(sourceText, filePath, opts);
    parentPort!.postMessage({ id, triples } satisfies WorkerIPC.AstResponse);
  } catch (err: unknown) {
    parentPort!.postMessage({
      id,
      triples: [],
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerIPC.AstResponse);
  }
});

// Signal readiness immediately - no async init needed.
parentPort!.postMessage({ ready: true });
