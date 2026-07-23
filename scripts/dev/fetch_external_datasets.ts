/**
 * Fetches the official AI2 RuleTaker + ProofWriter distributions and emits the
 * deterministic stratified samples committed at data/benchmarks/*.jsonl
 * (see data/benchmarks/README.md for schema and provenance).
 *
 * Run: tsx scripts/dev/fetch_external_datasets.ts [--cache <dir>]
 *
 * --cache <dir>  reuse pre-downloaded zips from <dir> instead of downloading.
 *                Default cache is data/benchmarks/.cache (not committed).
 *
 * Sampling is seeded (mulberry32, SEED=42) and output is sorted, so re-running
 * against the same official zips reproduces byte-identical JSONL - the
 * committed samples stay auditable against the AI2 distribution.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SEED = 42;
const DEPTHS = [0, 1, 2, 3, 5] as const;
const RULETAKER_PER_DEPTH = 20; // 10 true / 10 false
const PROOFWRITER_PER_DEPTH = 12; // 4 true / 4 false / 4 unknown

const SOURCES = {
  ruletaker: {
    url: "https://aristo-data-public.s3.amazonaws.com/ruletaker/rule-reasoning-dataset-V2020.2.5.zip",
    zip: "rule-reasoning-dataset-V2020.2.5.zip",
    member: (d: number) =>
      `rule-reasoning-dataset-V2020.2.5.0/original/depth-${d}/test.jsonl`,
  },
  proofwriter: {
    url: "https://aristo-data-public.s3.amazonaws.com/proofwriter/proofwriter-dataset-V2020.12.3.zip",
    zip: "proofwriter-dataset-V2020.12.3.zip",
    member: (d: number) =>
      `proofwriter-dataset-V2020.12.3/OWA/depth-${d}/meta-test.jsonl`,
  },
} as const;

interface SampleItem {
  id: string;
  theory: string;
  question: string;
  answer: "true" | "false" | "unknown";
  depth: number;
}

// Local PRNG instance (same mulberry32 as @utils/seededRandom, but instanced
// so this script never touches the engine's global RNG state).
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

/** Streams one zip member's lines via `unzip -p` (no full extraction). */
function readMemberLines(zipPath: string, member: string): string[] {
  const out = spawnSync("unzip", ["-p", zipPath, member], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: "utf8",
  });
  if (out.status !== 0)
    throw new Error(`unzip -p ${zipPath} ${member} failed: ${out.stderr}`);
  return out.stdout.split("\n").filter(l => l.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Per-dataset samplers (schemas verified against the official distributions)
// ---------------------------------------------------------------------------

/** RuleTaker: {id, context, questions: [{id, text, label: bool, meta:{QDep}}]} */
function sampleRuleTaker(zipPath: string, rand: () => number): SampleItem[] {
  const picked: SampleItem[] = [];
  for (const depth of DEPTHS) {
    const candidates: SampleItem[] = [];
    for (const line of readMemberLines(zipPath, SOURCES.ruletaker.member(depth))) {
      const row = JSON.parse(line) as {
        id: string;
        context: string;
        questions: {
          id: string;
          text: string;
          label: boolean;
          meta?: { QDep?: number };
        }[];
      };
      for (const q of row.questions) {
        // Stratify on the question's own proof depth, not the folder's cap.
        if (q.meta?.QDep !== depth) continue;
        candidates.push({
          id: q.id,
          theory: row.context,
          question: q.text,
          answer: q.label ? "true" : "false",
          depth,
        });
      }
    }
    const byLabel = (l: SampleItem["answer"]) =>
      shuffled(candidates.filter(c => c.answer === l), rand);
    picked.push(
      ...byLabel("true").slice(0, RULETAKER_PER_DEPTH / 2),
      ...byLabel("false").slice(0, RULETAKER_PER_DEPTH / 2)
    );
  }
  return picked;
}

/** ProofWriter OWA: {id, theory, questions: {Qn: {question, answer: bool|"Unknown", QDep}}} */
function sampleProofWriter(zipPath: string, rand: () => number): SampleItem[] {
  const picked: SampleItem[] = [];
  for (const depth of DEPTHS) {
    const candidates: SampleItem[] = [];
    for (const line of readMemberLines(zipPath, SOURCES.proofwriter.member(depth))) {
      const row = JSON.parse(line) as {
        id: string;
        theory: string;
        questions: Record<
          string,
          { question: string; answer: boolean | string; QDep?: number | null }
        >;
      };
      for (const [qid, q] of Object.entries(row.questions)) {
        const answer: SampleItem["answer"] | null =
          q.answer === true
            ? "true"
            : q.answer === false
              ? "false"
              : typeof q.answer === "string" &&
                  q.answer.toLowerCase() === "unknown"
                ? "unknown"
                : null;
        if (answer === null) continue;
        // true/false stratify on QDep; unknown has no proof depth - tag with
        // the theory folder's depth so every stratum carries abstention gold.
        if (answer !== "unknown" && q.QDep !== depth) continue;
        candidates.push({
          id: `${row.id}-${qid}`,
          theory: row.theory,
          question: q.question,
          answer,
          depth,
        });
      }
    }
    const byLabel = (l: SampleItem["answer"]) =>
      shuffled(candidates.filter(c => c.answer === l), rand);
    picked.push(
      ...byLabel("true").slice(0, PROOFWRITER_PER_DEPTH / 3),
      ...byLabel("false").slice(0, PROOFWRITER_PER_DEPTH / 3),
      ...byLabel("unknown").slice(0, PROOFWRITER_PER_DEPTH / 3)
    );
  }
  return picked;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const outDir = join(import.meta.dirname ?? __dirname, "..", "..", "data", "benchmarks");
  const cacheIdx = process.argv.indexOf("--cache");
  const cacheDir =
    cacheIdx >= 0 ? process.argv[cacheIdx + 1] : join(outDir, ".cache");
  mkdirSync(cacheDir, { recursive: true });

  execFileSync("unzip", ["-v"], { stdio: "ignore" }); // fail fast if missing

  for (const src of Object.values(SOURCES)) {
    const zipPath = join(cacheDir, src.zip);
    if (!existsSync(zipPath)) await download(src.url, zipPath);
    else console.log(`  cache hit: ${src.zip}`);
  }

  const emit = (name: string, items: SampleItem[]): void => {
    // Stable order for byte-identical re-runs and reviewable diffs.
    items.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    const path = join(outDir, name);
    writeFileSync(path, `${items.map(i => JSON.stringify(i)).join("\n")}\n`);
    const byAnswer = items.reduce<Record<string, number>>((acc, i) => {
      acc[i.answer] = (acc[i.answer] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `  wrote ${path}: ${items.length} items (${Object.entries(byAnswer)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")})`
    );
  };

  console.log("Sampling RuleTaker...");
  emit(
    "ruletaker_sample.jsonl",
    sampleRuleTaker(join(cacheDir, SOURCES.ruletaker.zip), mulberry32(SEED))
  );
  console.log("Sampling ProofWriter (OWA)...");
  emit(
    "proofwriter_sample.jsonl",
    sampleProofWriter(join(cacheDir, SOURCES.proofwriter.zip), mulberry32(SEED))
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
