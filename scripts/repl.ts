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
import LogicAtomizer from "@atomics/LogicAtomizer";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import Store from "@core_s/Memory";
import { LiveInference } from "@core_i/LiveInference";
import Unfolder from "@core_s/Unfolder";
import { SelfConcept } from "@core_s/Identity";
import { SpectralVisualizer } from "@utils/SpectralVisualizer";

// ── ANSI helpers ─────────────────────────────────────────────────────────────

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

// ── OperatorClass labels ──────────────────────────────────────────────────────

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

// ── Session state ─────────────────────────────────────────────────────────────

let system: System;
let atomizer: Atomic.Engine;
let resolver: Resolver;
let store: Store;
let unfolder: Unfolder;
let inference: LiveInference;
const viz = new SpectralVisualizer();

let verbose = false;
let atomMode: "semantic" | "base" = "semantic";
let dbPath = "./data/repl.db";
const self = new SelfConcept();

let sessionIngested = 0;
let sessionQueried = 0;
let sessionDiscovered = 0;

// ── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--base")) atomMode = "base";
  const dbArg = args.find(a => a.startsWith("--db="));
  if (dbArg) dbPath = dbArg.slice(5);

  process.stdout.write(
    `\n${bold(cyan("╔══════════════════════════════════════╗"))}\n` +
      `${bold(cyan("║"))}   ${bold("ModPAT Live Inference REPL")}        ${bold(cyan("║"))}\n` +
      `${bold(cyan("╚══════════════════════════════════════╝"))}\n\n`
  );

  system = new System();
  tick("System allocated (1 M precept capacity)");

  if (atomMode === "semantic") {
    const sem = new SemanticAtomizer();
    process.stdout.write(
      gray("  Initializing SemanticAtomizer (GloVe + UMAP)…")
    );
    const t0 = Date.now();
    try {
      await sem.init();
      const ms = Date.now() - t0;
      process.stdout.write(`\r`);
      tick(`SemanticAtomizer ready ${gray(`(${ms} ms)`)}`);
      atomizer = sem;
    } catch (e: any) {
      process.stdout.write(`\r`);
      warn(
        `SemanticAtomizer failed (${e.message}) — falling back to LogicAtomizer`
      );
      atomMode = "base";
      const log = new LogicAtomizer();
      await log.init();
      atomizer = log;
    }
  } else {
    const log = new LogicAtomizer();
    await log.init();
    tick("LogicAtomizer ready");
  }

  // Ensure data dir exists for the db file.
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  store = new Store(system, atomizer, dbPath);
  await store.waitForInit();
  tick(`Store ready ${gray(`(${dbPath})`)}`);

  resolver = new Resolver(system, atomizer, store);
  unfolder = new Unfolder(system, atomizer as any);
  inference = new LiveInference(system, atomizer, resolver, store, unfolder);
  tick("Resolver and LiveInference online");

  // WordNet dictionary initialises in the background (~2s).
  unfolder.dictionary.waitForInit().then(() => {
    if (unfolder.dictionary.isReady) {
      tick(`WordNet 3.1 ready ${gray("— void route: dictionary → wikipedia")}`);
    }
  });

  await self.initialize(system, atomizer, store);
  tick(
    `Self-concept online ${gray(`(id=${self.selfId} scope=${self.selfScope})`)}  ` +
      `— ${cyan('"the system is online"')}`
  );

  process.stdout.write(
    `\n  ${gray("atomizer:")} ${atomMode}   ${gray("db:")} ${dbPath}\n` +
      `  Type ${cyan(":help")} for commands.\n\n`
  );
}

function tick(msg: string) {
  process.stdout.write(`  ${green("✓")} ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`  ${yellow("⚠")} ${msg}\n`);
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

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
  return dim(`[${parts.join("  ")}]`);
}

function countAllocated(): number {
  let n = 0;
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i)) n++;
  }
  return n;
}

// ── Verbose diagnostics ───────────────────────────────────────────────────────

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
}

// ── Command handling ──────────────────────────────────────────────────────────

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
          `    db: ${gray(dbPath)}  atomizer: ${gray(atomMode)}\n\n`
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
      const report = await inference.getSelfTeacher().runCycle(count);
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

    case "reset": {
      system.reset();
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

// ── Input handling ────────────────────────────────────────────────────────────

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
    if (self.selfId !== -1) {
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
    process.stdout.write(
      `  ${green("↳")} ${replyText}  ${statsBar(sinkStr > 0 ? sinkStr : null)}\n\n`
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
    store
  );

  for (const item of toAsk) {
    process.stdout.write(
      `  ${yellow("❓")} ${bold("I couldn't understand")} ${cyan(`"${item.topic}"`)}\n` +
        `     ${dim(`(from: "${item.originalQuery.replace(/\|-\s*$/, "").trim()}")`)} \n` +
        `     Can you tell me what ${cyan(`"${item.topic}"`)} means?\n\n`
    );
  }
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  process.stdout.write(
    `\n  ${gray(`Session: ${sessionIngested} ingested  ${sessionQueried} queried  ${sessionDiscovered} operators discovered`)}\n` +
      `  ${gray("Closing store…")}`
  );
  try {
    await resolver.dispose();
    await store.close();
    process.stdout.write(` ${green("done")}\n`);
  } catch {
    process.stdout.write(` ${yellow("(already closed)")}\n`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

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
