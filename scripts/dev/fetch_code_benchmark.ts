/**
 * Fetches the MultiPL-E TypeScript translation of HumanEval and emits the
 * vendored copy at data/benchmarks/humaneval_ts.jsonl (see the "HumanEval-TS"
 * section of data/benchmarks/README.md for schema and provenance).
 *
 * Run: tsx scripts/dev/fetch_code_benchmark.ts [--cache <dir>]
 *
 * --cache <dir>  reuse a pre-downloaded parquet from <dir> instead of fetching.
 *                Default cache is data/benchmarks/.cache (not committed).
 *
 * WHY TypeScript and not the original Python: PARITY §3.5 names the code
 * domain's asset as "tsx execution = free territory contact" - the survey loop
 * gets ground truth by RUNNING the candidate, in a child process that never
 * sees a manifold coordinate (the same non-circularity argument
 * CodeBehaviouralFidelity.ts makes for arithmetic). That argument only holds in
 * a language this repo can already execute, and the Synthesizer emits
 * TypeScript. MultiPL-E is HumanEval's canonical multi-language translation, so
 * the problems are the standard ones and the test harness is executable here.
 *
 * The whole set (159 problems) is vendored rather than sampled: it is small,
 * and "the actual dataset files through the pipeline" (PARITY §2's honesty
 * caveat) is the entire point of this file existing.
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DuckDBInstance } from "@duckdb/node-api";

const SOURCE = {
  url: "https://huggingface.co/datasets/nuprl/MultiPL-E/resolve/main/humaneval-ts/test-00000-of-00001.parquet",
  file: "humaneval-ts.parquet",
};

/** One synthesis problem. `prompt` ends mid-signature, as HumanEval's does. */
interface CodeItem {
  /** e.g. "HumanEval_0_has_close_elements" */
  id: string;
  /** The function under synthesis, e.g. "has_close_elements". */
  entryPoint: string;
  /** Comment block + signature + opening brace, verbatim from MultiPL-E. */
  prompt: string;
  /** Executable TypeScript asserting the function's behaviour. */
  tests: string;
  /** Completion cut points, verbatim from MultiPL-E. */
  stopTokens: string[];
}

async function download(url: string, dest: string): Promise<void> {
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    createWriteStream(dest)
  );
}

/**
 * The entry point is the last `function <name>(` in the prompt - MultiPL-E
 * prompts may declare helper types above the signature under synthesis.
 */
function entryPointOf(prompt: string, name: string): string {
  const matches = [...prompt.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
  if (matches.length > 0) return matches[matches.length - 1][1];
  // Fall back to the dataset's own naming convention: HumanEval_<n>_<entry>.
  const m = name.match(/^HumanEval_\d+_(.+)$/);
  if (!m) throw new Error(`cannot determine entry point for ${name}`);
  return m[1];
}

async function main(): Promise<void> {
  const outDir = join(
    import.meta.dirname ?? __dirname,
    "..",
    "..",
    "data",
    "benchmarks"
  );
  const cacheIdx = process.argv.indexOf("--cache");
  const cacheDir =
    cacheIdx >= 0 ? process.argv[cacheIdx + 1] : join(outDir, ".cache");
  mkdirSync(cacheDir, { recursive: true });

  const parquet = join(cacheDir, SOURCE.file);
  if (!existsSync(parquet)) await download(SOURCE.url, parquet);
  else console.log(`  cache hit: ${SOURCE.file}`);

  // DuckDB is already a dependency (the vault), so parquet needs no new one.
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const reader = await conn.runAndReadAll(
    `SELECT name, prompt, tests, stop_tokens
       FROM read_parquet('${parquet.replace(/'/g, "''")}')
      ORDER BY name`
  );
  const rows = reader.getRows();

  const items: CodeItem[] = rows.map(r => {
    const name = String(r[0]);
    const prompt = String(r[1]);
    return {
      id: name,
      entryPoint: entryPointOf(prompt, name),
      prompt,
      tests: String(r[2]),
      // DuckDB returns LIST columns as DuckDBListValue, not a JS array.
      stopTokens: (r[3] as { items: unknown[] }).items.map(String),
    };
  });

  // Stable order for byte-identical re-runs and reviewable diffs. Sorted by
  // the numeric HumanEval index so the file reads in the canonical order.
  const idx = (id: string): number => Number(id.match(/^HumanEval_(\d+)_/)?.[1] ?? 0);
  items.sort((a, b) => idx(a.id) - idx(b.id) || a.id.localeCompare(b.id));

  const path = join(outDir, "humaneval_ts.jsonl");
  writeFileSync(path, `${items.map(i => JSON.stringify(i)).join("\n")}\n`);
  console.log(`  wrote ${path}: ${items.length} problems`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
