/**
 * ModPAT Live Inference REPL
 *
 * Usage:
 *   tsx scripts/repl.ts            # semantic atomizer (GloVe + UMAP)
 *   tsx scripts/repl.ts --base     # logic atomizer (no embeddings needed)
 *   tsx scripts/repl.ts --db=path  # use a specific DuckDB file
 *
 * Input is passed directly to processIntent.
 * Prefix with : for shell commands — type :help to list them.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";
import System, { OperatorClass } from "@core_i/System";
import Resolver from "@core_i/Resolver";
import Store from "@core_s/Memory";
import { LiveInference } from "@core_i/Runtime";
import Unfolder from "@core_s/Unfolder";
import { SelfConcept } from "@core_s/Identity";
import { SpectralVisualizer } from "@utils/SpectralVisualizer";
import Runtime from "@core_i/Runtime";
import { VocabSeedWorker } from "@core_s/VocabSeed";
import {
  distance4D,
  orbitRadius,
  orbitalParent,
  satellites,
  constellations,
  constellationGaps,
  buildManifoldIndex,
} from "@core_s/ManifoldMetrics";
import { SYSTEM_CONFIG, DOPAT_CONFIG } from "@config";

// ANSI helpers

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};

const c =
  (code: string) =>
  (s: string): string =>
    `${code}${s}${C.reset}`;

const bold = c(C.bold);
const dim = c(C.dim);
const cyan = c(C.cyan);
const green = c(C.green);
const yellow = c(C.yellow);
const red = c(C.red);
const gray = c(C.dim + C.gray);
const magenta = c(C.magenta);

// OperatorClass labels

const OP_NAME = [
  "None",
  "IdentityShift",
  "Conjunction",
  "Sink",
  "Quantifier",
  "Modifier",
  "Inversion",
  "Action",
  "Query",
  "SyntaxAnchor",
];

function opColor(cls: number): string {
  if (cls === OperatorClass.None) return C.dim;
  if (cls === OperatorClass.IdentityShift) return C.cyan;
  if (cls === OperatorClass.Conjunction) return C.blue;
  if (cls === OperatorClass.Sink) return C.magenta;
  if (cls === OperatorClass.Inversion) return C.red;
  if (cls === OperatorClass.Action) return C.green;
  if (cls === OperatorClass.Query) return C.yellow;
  return C.white;
}

// Session state

let runtime: Runtime;
let system: System;
let atomizer: Atomic.Engine;
let resolver: Resolver;
let store: Store;
let unfolder: Unfolder;
let inference: LiveInference;
let self: SelfConcept | null = null;
const viz = new SpectralVisualizer();

let seeder: VocabSeedWorker | null = null;

let verbose = false;
let atomMode: "semantic" | "base" | "spectral" = "semantic";
let dbPath = "./data/repl.db";

let sessionIngested = 0;
let sessionQueried = 0;
let sessionDiscovered = 0;

// Init

async function init(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--base")) atomMode = "base";
  if (args.includes("--spectral")) atomMode = "spectral";
  const dbArg = args.find(a => a.startsWith("--db="));
  if (dbArg) dbPath = dbArg.slice(5);

  process.stdout.write(`\n  ModPAT Live Inference REPL\n\n`);

  // Ensure data dir exists for the db file.
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  process.stdout.write(gray("  Booting runtime…\n"));
  const t0 = Date.now();

  runtime = await Runtime.boot({
    atomizer: atomMode,
    db: dbPath,
    onFallback: reason => {
      warn(
        `SemanticAtomizer unavailable (${reason}) — falling back to LogicAtomizer`
      );
    },
  });

  ({ system, atomizer, resolver, store, unfolder, inference } = runtime);
  atomMode = runtime.atomizerMode;
  self = runtime.identity;

  const ms = Date.now() - t0;
  process.stdout.write("\r");
  tick(
    `Runtime online ${gray(`(${atomMode}, ${ms} ms)`)}  ` +
      `tick ${gray(`every ${runtime.tickIntervalMs / 1000}s`)}`
  );

  // WordNet dictionary initialises in the background (~2s), then the
  // vocabulary seeder starts — no need to await it.
  unfolder.dictionary.waitForInit().then(() => {
    if (!unfolder.dictionary.isReady) return;
    tick(`WordNet 3.1 ready ${gray("— void route: dictionary → wikipedia")}`);

    seeder = new VocabSeedWorker(SYSTEM_CONFIG.DOD_EMBEDDING.UMAP_DICT_PATH);
    if (seeder.total > 0) {
      tick(
        `Vocab seeder armed ${gray(`(${seeder.total.toLocaleString()} words)`)}`
      );
      seeder.start(system, atomizer, store, unfolder.dictionary, {
        batchSize: 20,
        intervalMs: 150,
        onProgress: p => {
          if (p.processed % 1000 === 0) {
            const pct = ((p.processed / p.total) * 100).toFixed(1);
            tick(
              `Vocab seed: ${pct}% — ${p.matured.toLocaleString()} constellations formed`
            );
          }
        },
      });
    }
  });

  if (self) {
    tick(
      `Self-concept online ${gray(`(id=${self.selfId} scope=${self.selfScope})`)}  ` +
        `— ${cyan('"the system is online"')}`
    );
  }

  process.stdout.write(
    `\n  ${gray("atomizer:")} ${atomMode}   ${gray("db:")} ${dbPath}\n` +
      `  Type ${cyan(":help")} for commands.\n\n`
  );

  // Background constellation gap scanner — runs every 30s, quietly enqueues
  // the most strained atom pair in each top constellation as an inquiry topic.
  // The gap represents a gravitational bond with no known inferential basis;
  // investigating it may either confirm the connection or split the constellation.
  const GAP_SCAN_INTERVAL_MS = 30_000;
  const runGapScan = () => {
    const idx = buildManifoldIndex(system);
    const cs = constellations(system, { minSize: 3, index: idx });
    if (cs.length === 0) return;
    const gaps = constellationGaps(system, cs.slice(0, 15), atomizer, {
      maxPerConstellation: 1,
      minMassRatio: 0.05,
    });
    const queue = inference.getInquiryQueue();
    for (const g of gaps.slice(0, 2)) {
      const topic = g.labelA;
      const query = `What is the relationship between ${g.labelA} and ${g.labelB}?`;
      queue.enqueue(topic, query);
    }
  };
  const scheduleGapScan = () => {
    setTimeout(() => {
      try {
        runGapScan();
      } catch {}
      scheduleGapScan();
    }, GAP_SCAN_INTERVAL_MS);
  };
  scheduleGapScan();
}

function tick(msg: string) {
  process.stdout.write(`  ${green("✓")} ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`  ${yellow("⚠")} ${msg}\n`);
}

// Stats bar

let cachedKnowledge = { heard: 0, remembered: 0, learned: 0, generalized: 0 };

function refreshKnowledge(): void {
  store
    .getKnowledgeSummary()
    .then(s => {
      cachedKnowledge = s;
    })
    .catch(() => {});
}

function statsBar(sinkStrength: number | null): string {
  const allocated = countAllocated();
  const discovered = resolver.lastDiscoveredOperators.length;
  const k = cachedKnowledge;
  const parts: string[] = [gray(`${allocated} precepts`)];
  if (sinkStrength !== null && sinkStrength > 0) {
    parts.push(gray(`sink: ${sinkStrength.toFixed(3)}`));
  }
  if (discovered > 0) {
    parts.push(yellow(`+${discovered} discovered`));
  }
  const total = k.heard + k.remembered + k.learned + k.generalized;
  if (total > 0) {
    const tier = [
      k.heard > 0 ? gray(`${k.heard}H`) : "",
      k.remembered > 0 ? dim(`${k.remembered}R`) : "",
      k.learned > 0 ? green(`${k.learned}L`) : "",
      k.generalized > 0 ? cyan(`${k.generalized}G`) : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(tier);
  }
  if (seeder && !seeder.isDone) {
    const pct =
      seeder.total > 0
        ? Math.floor((seeder.processed / seeder.total) * 100)
        : 0;
    parts.push(
      seeder.running ? magenta(`seed:${pct}%`) : gray(`seed:${pct}%⏸`)
    );
  }
  return dim(`[${parts.join("  ")}]`);
}

function countAllocated(): number {
  let n = 0;
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i)) n++;
  }
  return n;
}

// Verbose diagnostics

function showVerbose(): void {
  const diag = resolver.lastDiagnostics;
  if (!diag) return;

  // Token sequence with operator classes
  const tokenLine = diag.tokenLabels
    .map((label, i) => {
      const cls = diag.operatorClasses[i];
      const col = opColor(cls);
      const name = OP_NAME[cls] ?? "?";
      return `${col}${label}${C.reset}${gray(`[${name}]`)}`;
    })
    .join("  ");

  process.stdout.write(`  ${gray("tokens:")} ${tokenLine}\n`);

  // Coherence score + top sink candidates
  if (diag.sinkCandidates.length > 0) {
    const best = diag.sinkCandidates[0];
    const second = diag.sinkCandidates[1]?.strength ?? 0;
    const amplitude = diag.maxNetEnergy / (1 + diag.maxNetEnergy);
    const contrast = second <= 0 ? 1 : best.strength / (best.strength + second);
    const coherence = amplitude * contrast;
    const coherenceStr =
      coherence >= 0.25
        ? green(coherence.toFixed(3))
        : coherence > 0
          ? yellow(coherence.toFixed(3))
          : gray("0.000");
    process.stdout.write(
      `  ${gray("target:")} ${cyan(best.label)}  ${gray(`strength=${best.strength.toFixed(4)}`)}  coherence=${coherenceStr}\n`
    );
  }

  // Bridge candidates from the bidirectional pass
  const bridges = diag.bridgeCandidates;
  if (bridges.length > 0) {
    const missingLinks = bridges.filter(b => b.isMissingLink);
    const bridgeLine = bridges
      .slice(0, 4)
      .map(b => {
        const score = `${b.bridgeScore.toFixed(3)}`;
        const tag = b.isMissingLink ? red("?") : green("↔");
        return `${tag}${cyan(b.label)}${gray(`(${score})`)}`;
      })
      .join("  ");
    process.stdout.write(`  ${gray("bridge:")} ${bridgeLine}\n`);
    if (missingLinks.length > 0) {
      const missingLine = missingLinks
        .slice(0, 3)
        .map(b => red(b.label))
        .join("  ");
      process.stdout.write(
        `  ${red("missing:")} ${missingLine}  ${gray("← ask about these")}\n`
      );
    }
  }

  // Discovered operators
  const disc = resolver.lastDiscoveredOperators;
  if (disc.length > 0) {
    const discLine = disc
      .map(
        d =>
          `${yellow(d.label)}${gray(`→${OP_NAME[d.inferredClass]}(${d.confidence.toFixed(2)})}`)}`
      )
      .join("  ");
    process.stdout.write(`  ${gray("discovered:")} ${discLine}\n`);
    sessionDiscovered += disc.filter(d => d.confidence >= 0.55).length;
  }

  // Wave amplitude bar for the token sequence (normalized time values)
  const N = diag.tokenLabels.length;
  if (N > 0) {
    const rowIds = new Uint32Array(N);
    // We don't have direct IDs from lastDiagnostics, so render a synthetic bar
    // using raw resonance column sums (incoming energy = amplitude peak).
    const acc = diag.accumulated;
    const bar = diag.tokenLabels
      .map((label, i) => {
        let incoming = 0;
        for (let j = 0; j < N; j++) {
          if (j !== i) incoming += Math.abs(acc[j * N + i]);
        }
        const normalized = Math.min(1, incoming);
        const height = Math.round(normalized * 6);
        const blocks = " ▁▂▃▄▅▆";
        const ch = blocks[Math.min(height, blocks.length - 1)];
        const col = opColor(diag.operatorClasses[i]);
        const pad = " ".repeat(Math.max(0, label.length - 1));
        return `${col}${ch}${pad}${C.reset}`;
      })
      .join("");
    const labelLine = diag.tokenLabels
      .map((label, i) => {
        const col = opColor(diag.operatorClasses[i]);
        return `${col}${label}${C.reset}`;
      })
      .join(" ");
    process.stdout.write(`  ${gray("wave:")} ${bar}\n`);
    process.stdout.write(`         ${labelLine}\n`);
  }

  // Working memory context
  const wm = inference.getWorkingMemory();
  if (wm.size > 0) {
    const recent = wm
      .recent(3)
      .map(
        f =>
          `${cyan(f.conclusion)}${f.explanation ? gray(`→${f.explanation.split(" → ").pop()}`) : ""}`
      )
      .join("  ");
    process.stdout.write(`  ${gray("context:")} ${recent}\n`);
  }
}

// Command handling

async function handleCommand(raw: string): Promise<void> {
  const parts = raw.slice(1).trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "help":
    case "h": {
      process.stdout.write(
        `\n  ${bold("Commands:")}\n` +
          `  ${cyan(":help")}              this message\n` +
          `  ${cyan(":verbose")} ${gray("[on|off]")}  toggle physics diagnostics (current: ${verbose ? green("on") : gray("off")})\n` +
          `  ${cyan(":stats")}             manifold and session summary\n` +
          `  ${cyan(":load")} ${gray("<file>")}       ingest facts from a text file (one per line)\n` +
          `  ${cyan(":code")} ${gray("<file>")}       learn code patterns from a .ts/.js file\n` +
          `  ${cyan(":learn")} ${gray("[n]")}         run n self-test cycles (default 10)\n` +
          `  ${cyan(":knowledge")}         show knowledge state breakdown (Heard/Remembered/Learned)\n` +
          `  ${cyan(":challenge")} ${gray("<q>")}     probe a query without vault recall\n` +
          `  ${cyan(":seed")} ${gray("[pause|resume]")}  vocab seeder status / control\n` +
          `  ${cyan(":orbit")} ${gray("<word>")}        orbital info for a specific atom\n` +
          `  ${cyan(":constellations")} ${gray("[n]")}  show top n constellations (default 10)\n` +
          `  ${cyan(":memory")}            working memory — what has been established\n` +
          `  ${cyan(":gaps")} ${gray("[n]")}           top n constellation gaps (curiosity targets)\n` +
          `  ${cyan(":reset")}             clear the manifold (not the store)\n` +
          `  ${cyan(":exit")} / Ctrl-C     quit\n\n`
      );
      break;
    }

    case "verbose":
    case "v": {
      const flag = args[0]?.toLowerCase();
      verbose = flag === "on" ? true : flag === "off" ? false : !verbose;
      process.stdout.write(
        `  verbose: ${verbose ? green("on") : gray("off")}\n\n`
      );
      break;
    }

    case "stats": {
      const allocated = countAllocated();
      let opCounts = new Array(OP_NAME.length).fill(0);
      for (let i = 0; i < system.length; i++) {
        if (system.isAllocated(i)) opCounts[system.operatorClass[i]]++;
      }
      process.stdout.write(
        `\n  ${bold("Manifold")}\n` +
          `    allocated: ${cyan(String(allocated))}  total slots: ${system.length}\n` +
          `    operators: ${opCounts
            .map((n, cls) =>
              n > 0 && cls !== OperatorClass.None
                ? `${gray(OP_NAME[cls])}=${n}`
                : ""
            )
            .filter(Boolean)
            .join("  ")}\n` +
          `\n  ${bold("Session")}\n` +
          `    ingested: ${sessionIngested}  queried: ${sessionQueried}  operators discovered: ${sessionDiscovered}\n` +
          `    db: ${gray(dbPath)}  atomizer: ${gray(atomMode)}\n` +
          `    tick: ${runtime.isTickRunning ? green(`every ${runtime.tickIntervalMs / 1000}s`) : yellow("stopped")}  ` +
          `age decay: ${gray(`half-life ≈ ${(Math.LN2 / DOPAT_CONFIG.PHYSICS.AGE_DECAY_RATE).toFixed(0)}s`)}\n\n`
      );
      break;
    }

    case "load": {
      const filePath = args[0];
      if (!filePath) {
        warn(":load requires a file path");
        break;
      }
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        warn(`File not found: ${resolved}`);
        break;
      }
      const ext = path.extname(resolved).toLowerCase();
      if (ext === ".ts" || ext === ".js") {
        process.stdout.write(gray(`  Loading code from ${filePath}…\n`));
        const src = fs.readFileSync(resolved, "utf8");
        const result = await inference.processCode(src);
        process.stdout.write(`  ${green("↳")} ${result}\n\n`);
      } else {
        const lines = fs
          .readFileSync(resolved, "utf8")
          .split("\n")
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith("#"));
        process.stdout.write(
          gray(`  Ingesting ${lines.length} facts from ${filePath}…\n`)
        );
        for (const line of lines) {
          await inference.processCommand(line);
          sessionIngested++;
        }
        process.stdout.write(
          `  ${green("✓")} Ingested ${lines.length} facts.\n\n`
        );
      }
      break;
    }

    case "code": {
      const filePath = args[0];
      if (!filePath) {
        warn(":code requires a .ts/.js file path");
        break;
      }
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        warn(`File not found: ${resolved}`);
        break;
      }
      const src = fs.readFileSync(resolved, "utf8");
      process.stdout.write(gray(`  Processing code from ${filePath}…\n`));
      const result = await inference.processCode(src);
      process.stdout.write(`  ${green("↳")} ${result}\n\n`);
      break;
    }

    case "learn":
    case "l": {
      const n = parseInt(args[0] ?? "10", 10);
      const count = Number.isFinite(n) && n > 0 ? n : 10;
      process.stdout.write(gray(`  Running ${count} self-test cycles…\n`));
      const t0 = Date.now();
      const report = await inference.getLearner().runCycle(count);
      const ms = Date.now() - t0;
      const k = report.summary;
      process.stdout.write(
        `\n  ${bold("Self-test report")} ${gray(`(${ms} ms)`)}\n` +
          `    challenged: ${report.challenged}  promoted: ${green(String(report.promoted))}  failed: ${report.failed > 0 ? red(String(report.failed)) : gray("0")}\n` +
          `    knowledge: ${gray(k.heard + "H")} ${k.remembered > 0 ? dim(k.remembered + "R") : gray("0R")} ${k.learned > 0 ? green(k.learned + "L") : gray("0L")} ${k.generalized > 0 ? cyan(k.generalized + "G") : ""}\n` +
          (report.expandedTopics.length > 0
            ? `    expanded: ${report.expandedTopics.map(t => yellow(t)).join(", ")}\n`
            : "") +
          "\n"
      );
      cachedKnowledge = report.summary;
      break;
    }

    case "knowledge":
    case "k": {
      const summary = await store.getKnowledgeSummary();
      cachedKnowledge = summary;
      const total =
        summary.heard +
        summary.remembered +
        summary.learned +
        summary.generalized;
      process.stdout.write(
        `\n  ${bold("Knowledge states")} ${gray(`(${total} total proofs)`)}\n` +
          `    ${gray("Heard")}      ${summary.heard}  — ingested, not yet tested\n` +
          `    ${dim("Remembered")} ${summary.remembered}  — recalled at least once\n` +
          `    ${green("Learned")}    ${summary.learned}  — independently reproduced in 2+ contexts\n` +
          `    ${cyan("Generalized")} ${summary.generalized}  — applied to novel inputs\n\n`
      );
      break;
    }

    case "challenge":
    case "ch": {
      const queryText = args.join(" ").trim();
      if (!queryText) {
        warn(":challenge requires a query (e.g. :challenge fire is)");
        break;
      }
      const probeText = queryText.endsWith("|-")
        ? queryText
        : queryText + " |-";
      process.stdout.write(
        gray(`  Coherence loop (probe mode): "${probeText}"\n`)
      );
      const probeIds = atomizer.ingestSequence(probeText, system);
      const result = await resolver.resolveCoherent(probeIds, {
        probeMode: true,
        maxIterations: 5,
      });
      const reproduced = atomizer.decodeSequence(result.ids, system).trim();
      const diagColor =
        result.diagnosis === "coherent"
          ? green
          : result.diagnosis === "conflict"
            ? yellow
            : result.diagnosis === "weak"
              ? dim
              : gray;
      process.stdout.write(
        `  ${result.diagnosis === "coherent" ? green("↳") : gray("↳")} ${reproduced || gray("(nothing)")}` +
          `  ${gray(`coherence=${result.coherence.toFixed(3)} iters=${result.iterations}`)}` +
          `  ${diagColor(result.diagnosis)}\n`
      );
      if (result.learned.length > 0) {
        process.stdout.write(
          `  ${gray("loop log:")} ${result.learned.map(l => dim(l)).join("  ")}\n`
        );
      }
      process.stdout.write("\n");
      break;
    }

    case "seed": {
      if (!seeder) {
        warn("Seeder not yet initialised — WordNet may still be loading.");
        break;
      }
      const sub = args[0]?.toLowerCase();
      if (sub === "pause") {
        seeder.pause();
        process.stdout.write(`  ${yellow("⏸")} Seeder paused.\n\n`);
      } else if (sub === "resume") {
        seeder.start(system, atomizer, store, unfolder.dictionary, {
          batchSize: 20,
          intervalMs: 150,
          onProgress: p => {
            if (p.processed % 1000 === 0) {
              const pct = ((p.processed / p.total) * 100).toFixed(1);
              tick(
                `Vocab seed: ${pct}% — ${p.matured.toLocaleString()} constellations formed`
              );
            }
          },
        });
        process.stdout.write(`  ${green("▶")} Seeder resumed.\n\n`);
      } else {
        const p = seeder.snapshot();
        const pct =
          p.total > 0 ? ((p.processed / p.total) * 100).toFixed(1) : "0.0";
        const status = p.done
          ? cyan("complete")
          : p.running
            ? green("running")
            : yellow("paused");
        process.stdout.write(
          `\n  ${bold("Vocabulary seeder")}\n` +
            `    words: ${p.processed.toLocaleString()} / ${p.total.toLocaleString()} (${pct}%)\n` +
            `    constellations formed: ${green(p.matured.toLocaleString())}\n` +
            `    status: ${status}\n\n`
        );
      }
      break;
    }

    case "orbit":
    case "o": {
      const wordArg = args.join(" ").trim();
      if (!wordArg) {
        warn(":orbit requires a word");
        break;
      }
      const ids = atomizer.ingestSequence(wordArg, system);
      if (ids.length === 0) {
        warn(`"${wordArg}" not in manifold`);
        break;
      }
      const targetId = ids[0];
      const idx = buildManifoldIndex(system);
      const parent = orbitalParent(targetId, system, idx);
      const sats = satellites(targetId, system, idx);
      const r = orbitRadius(targetId, system);
      const parentLabel =
        parent !== null
          ? cyan(
              atomizer.decodeSequence(new Uint32Array([parent]), system).trim()
            )
          : gray("none");
      process.stdout.write(
        `\n  ${bold("Orbital info:")} ${cyan(wordArg)} ${gray(`(id=${targetId})`)}\n` +
          `    orbit radius:  ${r.toFixed(2)}\n` +
          `    parent:        ${parentLabel}${parent !== null ? gray(` (id=${parent})`) : ""}\n` +
          `    satellites:    ${
            sats.length > 0
              ? sats
                  .slice(0, 8)
                  .map(s =>
                    dim(
                      atomizer
                        .decodeSequence(new Uint32Array([s]), system)
                        .trim()
                    )
                  )
                  .join("  ")
              : gray("none")
          }\n` +
          (sats.length > 8
            ? `    ${gray(`… and ${sats.length - 8} more`)}\n`
            : "") +
          `\n`
      );
      break;
    }

    case "constellations":
    case "cs": {
      const n = parseInt(args[0] ?? "10", 10);
      const count = Number.isFinite(n) && n > 0 ? n : 10;
      process.stdout.write(gray(`  Computing constellations…\n`));
      const idx = buildManifoldIndex(system);
      const groups = constellations(system, { minSize: 2, index: idx });
      if (groups.length === 0) {
        process.stdout.write(
          `  ${gray("No constellations detected yet.")}\n\n`
        );
        break;
      }
      process.stdout.write(
        `\n  ${bold(`Top ${Math.min(count, groups.length)} constellations`)} ${gray(`(${groups.length} total)`)}\n`
      );
      for (const g of groups.slice(0, count)) {
        const starLabel = atomizer
          .decodeSequence(new Uint32Array([g.star]), system)
          .trim();
        const memberSample = g.members
          .slice(0, 5)
          .map(id =>
            dim(atomizer.decodeSequence(new Uint32Array([id]), system).trim())
          )
          .join(" ");
        process.stdout.write(
          `    ${cyan("★")} ${cyan(starLabel.padEnd(16))} ` +
            `${gray(`${g.members.length} members`)}  ${memberSample}` +
            (g.members.length > 5 ? gray(` +${g.members.length - 5}`) : "") +
            "\n"
        );
      }
      process.stdout.write("\n");
      break;
    }

    case "memory":
    case "mem": {
      const wm = inference.getWorkingMemory();
      const frames = wm.recent(wm.size);
      if (frames.length === 0) {
        process.stdout.write(`  ${gray("Working memory is empty.")}\n\n`);
        break;
      }
      process.stdout.write(
        `\n  ${bold("Working memory")} ${gray(`(${frames.length} turns)`)}\n`
      );
      for (const f of frames) {
        const expl = f.explanation ? gray(`  ← ${f.explanation}`) : "";
        process.stdout.write(
          `    ${gray(`T${f.turn}`)}  ${dim(f.query.slice(0, 40).padEnd(40))}` +
            `  ${cyan(f.conclusion)}${expl}\n`
        );
      }
      process.stdout.write("\n");
      break;
    }

    case "gaps":
    case "gap": {
      const n = parseInt(args[0] ?? "8", 10);
      const count = Number.isFinite(n) && n > 0 ? n : 8;
      process.stdout.write(gray(`  Scanning constellation gaps…\n`));
      const idx = buildManifoldIndex(system);
      const cs = constellations(system, { minSize: 3, index: idx });
      const gaps = constellationGaps(system, cs.slice(0, 20), atomizer, {
        maxPerConstellation: 2,
        minMassRatio: 0.05,
      });
      if (gaps.length === 0) {
        process.stdout.write(
          `  ${gray("No significant constellation gaps detected.")}\n\n`
        );
        break;
      }
      process.stdout.write(
        `\n  ${bold(`Top ${Math.min(count, gaps.length)} constellation gaps`)} ` +
          `${gray(`(curiosity targets)`)}\n`
      );
      for (const g of gaps.slice(0, count)) {
        const starLabel = atomizer
          .decodeSequence(new Uint32Array([g.constellation.star]), system)
          .trim();
        process.stdout.write(
          `    ${red("?")} ${cyan(g.labelA.padEnd(14))} ↔ ${cyan(g.labelB.padEnd(14))}` +
            `  ${gray(`dist=${g.distance.toFixed(1)}`)}  ${gray(`[★${starLabel}]`)}\n`
        );
      }
      process.stdout.write("\n");
      break;
    }

    case "reset": {
      system.reset();
      inference.getWorkingMemory().clear();
      sessionIngested = 0;
      sessionQueried = 0;
      sessionDiscovered = 0;
      process.stdout.write(`  ${yellow("↺")} Manifold cleared.\n\n`);
      break;
    }

    case "exit":
    case "quit":
    case "q": {
      await shutdown();
      process.exit(0);
    }

    default: {
      warn(`Unknown command: :${cmd}  (try :help)`);
    }
  }
}

// Input handling

async function handleInput(line: string): Promise<void> {
  if (!line) return;

  if (line.startsWith(":")) {
    await handleCommand(line);
    return;
  }

  const isIngestion =
    !line.match(/^(what|who|where|how|why|is|are|can|do|does)\b/i) &&
    !line.trim().endsWith("?") &&
    !line.includes("|-");

  if (isIngestion) sessionIngested++;
  else sessionQueried++;

  const responses: string[] = [];
  const prev = inference.respond;
  inference.respond = (r: string) => {
    responses.push(r);
  };

  await inference.processIntent(line);

  inference.respond = prev;

  refreshKnowledge();
  const sinkStr = resolver.lastSinkStrength;

  if (verbose) {
    showVerbose();
    // Flag self-referential queries so the ego-centre is visible in the loop.
    if (self && self.selfId !== -1) {
      const inputIds = atomizer.ingestSequence(line, system);
      if (self.isSelfReferential(inputIds, system)) {
        process.stdout.write(
          `  ${gray("self:")} ${cyan("⊙")} query routes through ego-centre ${gray(`(0,0,0,0) id=${self.selfId}`)}\n`
        );
      }
    }
  }

  const replyText = responses
    .join(" ")
    .replace(/^\[LiveInference\]: /, "")
    .trim();

  if (replyText) {
    // Show explanation from working memory (populated by processQuestion)
    const lastFrame = inference.getWorkingMemory().recent(1)[0];
    const explSuffix =
      lastFrame?.explanation && replyText.includes(lastFrame.conclusion)
        ? `  ${gray(`(${lastFrame.explanation})`)}`
        : "";
    process.stdout.write(
      `  ${green("↳")} ${replyText}${explSuffix}  ${statsBar(sinkStr > 0 ? sinkStr : null)}\n\n`
    );
  } else {
    process.stdout.write(`  ${gray("(no response)")}  ${statsBar(null)}\n\n`);
  }

  // After responding, drain one backlog item (dict → wiki → ask user).
  // Fire-and-forget: result is shown before the next prompt.
  await drainInquiryQueue();
}

/**
 * Process one pending inquiry item and surface any questions to the user.
 * Capped at one item per turn to keep the REPL responsive.
 */
async function drainInquiryQueue(): Promise<void> {
  const queue = inference.getInquiryQueue();
  if (queue.size === 0) return;

  const toAsk = await queue.step(
    1,
    unfolder,
    resolver,
    system,
    atomizer,
    store,
    (item, answer) => {
      // Inquiry loop closed: re-surface the answer the system just discovered.
      // The crystallization already happened inside _retry(); show it to the user.
      process.stdout.write(
        `  ${green("↺")} ${bold("Inquiry resolved:")} ${cyan(`"${item.topic}"`)} → ${green(answer)}\n` +
          `     ${dim(`(re-derived from "${item.originalQuery.replace(/\|-\s*$/, "").trim()}"`)}\n\n`
      );
    }
  );

  for (const item of toAsk) {
    process.stdout.write(
      `  ${yellow("❓")} ${bold("I need to understand")} ${cyan(`"${item.topic}"`)}\n` +
        `     ${dim(`(to answer: "${item.originalQuery.replace(/\|-\s*$/, "").trim()}")`)} \n` +
        `     Can you tell me what ${cyan(`"${item.topic}"`)} means, or how it relates to ${cyan(`"${item.originalQuery.split(" ")[0] ?? "the question"}"?`)}\n\n`
    );
  }
}

// Shutdown

async function shutdown(): Promise<void> {
  process.stdout.write(
    `\n  ${gray(`Session: ${sessionIngested} ingested  ${sessionQueried} queried  ${sessionDiscovered} operators discovered`)}\n` +
      `  ${gray("Closing store…")}`
  );
  try {
    await runtime.dispose();
    process.stdout.write(` ${green("done")}\n`);
  } catch {
    process.stdout.write(` ${yellow("(already closed)")}\n`);
  }
}

// Main loop

async function main(): Promise<void> {
  await init();

  const rl = createInterface({ input, output, terminal: true });

  const prompt = () => `${cyan("modpat")}${gray(">")} `;

  process.on("SIGINT", async () => {
    process.stdout.write("\n");
    await shutdown();
    process.exit(0);
  });

  while (true) {
    let line: string;
    try {
      line = await rl.question(prompt());
    } catch {
      break; // EOF
    }
    await handleInput(line.trim());
  }

  rl.close();
  await shutdown();
}

main().catch(e => {
  process.stderr.write(`Fatal: ${e.message}\n`);
  process.exit(1);
});
