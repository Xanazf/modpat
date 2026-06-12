/**
 * AstSeedWorker - background codebase-topology builder.
 *
 * Discovers TypeScript/JavaScript source files under given root paths,
 * extracts SVO triples from each file's AST, and crystallizes them into
 * the DuckDB vault so the Resolver can traverse the codebase's type
 * hierarchy, call graph, and import graph as physical manifold topology.
 *
 * Runs in background ticks (non-blocking) exactly like VocabSeedWorker.
 * Each tick processes one batch of files; the event loop remains free.
 *
 * posY (Kind axis) values from the plan:
 *   0.0 = type / interface      0.3 = function / method
 *   0.1 = class                 0.6 = variable
 *   0.8 = enum                  0.9 = module / import
 *
 * posZ (call depth) values from the plan:
 *   call depth N → posZ = N × 0.1
 */

import fs from "node:fs";
import path from "node:path";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import type Store from "@core_s/Memory";
import type { WorkerPool } from "@core_s/WorkerPool";
import { type AstTriple, extractAstTriples } from "@utils/astExtract";

export interface AstSeedProgress {
  processed: number;
  total: number;
  triples: number;
  running: boolean;
  done: boolean;
}

export interface AstSeedOptions {
  batchSize?: number;
  intervalMs?: number;
  callDepthLimit?: number;
  includeCallSites?: boolean;
  onProgress?: (p: AstSeedProgress) => void;
  pool?: WorkerPool;
  /** Node cap above which structural placement is skipped (Phase-4 boundary). */
  maxPlacementNodes?: number;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
]);

function discoverFiles(roots: string[]): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        // Skip declaration files - they duplicate type info from the source
        if (SOURCE_EXTENSIONS.has(ext) && !entry.name.endsWith(".d.ts")) {
          found.push(full);
        }
      }
    }
  }

  for (const root of roots) {
    const resolved = path.resolve(root);
    if (fs.existsSync(resolved)) walk(resolved);
  }

  return found;
}

export class AstSeedWorker {
  private readonly files: string[];
  private cursor = 0;
  private _running = false;
  private _triples = 0;
  private _processed = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** Triples accumulated across batches; grounded as one graph on completion. */
  private _accum: AstTriple[] = [];
  /** Guards the one-shot finalize (ground + place + crystallize). */
  private _finalized = false;

  get running(): boolean {
    return this._running;
  }
  get triples(): number {
    return this._triples;
  }
  get processed(): number {
    return this._processed;
  }
  get total(): number {
    return this.files.length;
  }
  get isDone(): boolean {
    return this.cursor >= this.files.length;
  }

  snapshot(): AstSeedProgress {
    return {
      processed: this._processed,
      total: this.files.length,
      triples: this._triples,
      running: this._running,
      done: this.isDone,
    };
  }

  constructor(rootPaths: string[], extensions?: string[]) {
    this.files = discoverFiles(rootPaths);
    if (extensions) {
      const allowed = new Set(extensions);
      this.files.splice(
        0,
        this.files.length,
        ...this.files.filter(f => allowed.has(path.extname(f)))
      );
    }
  }

  start(
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store: Store,
    opts: AstSeedOptions = {}
  ): void {
    if (this._running || this.isDone) return;
    this._running = true;

    const {
      batchSize = 3,
      intervalMs = 500,
      callDepthLimit = 5,
      includeCallSites = true,
      onProgress,
      pool,
      maxPlacementNodes = 3000,
    } = opts;

    const tick = () => {
      if (!this._running) return;
      if (this.isDone) {
        // All files parsed - ground the accumulated graph once, then stop.
        this._finalizeOnce(system, atomizer, store, maxPlacementNodes)
          .catch(err => console.error("[AstSeed] finalize error:", err))
          .finally(() => {
            this._running = false;
            onProgress?.(this.snapshot());
          });
        return;
      }
      this._processBatch(batchSize, { callDepthLimit, includeCallSites }, pool)
        .then(() => {
          onProgress?.(this.snapshot());
          this._timer = setTimeout(tick, intervalMs);
        })
        .catch(err => {
          console.error("[AstSeed] batch error:", err);
          this._timer = setTimeout(tick, 2000);
        });
    };

    this._timer = setTimeout(tick, 0);
  }

  pause(): void {
    this._running = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private async _processBatch(
    batchSize: number,
    extractOpts: { callDepthLimit: number; includeCallSites: boolean },
    pool?: WorkerPool
  ): Promise<void> {
    const end = Math.min(this.cursor + batchSize, this.files.length);

    for (let i = this.cursor; i < end; i++) {
      // Yield between files so GC can reclaim TS compiler API allocations.
      await new Promise<void>(r => setTimeout(r, 0));

      const filePath = this.files[i];

      let fileTriples: AstTriple[];
      if (pool?.parseAstFile) {
        try {
          const result = await pool.parseAstFile(filePath, extractOpts);
          fileTriples = result.triples;
        } catch {
          fileTriples = [];
        }
      } else {
        // Inline fallback - parses in the main thread.
        try {
          const sourceText = fs.readFileSync(filePath, "utf8");
          fileTriples = extractAstTriples(sourceText, filePath, extractOpts);
        } catch {
          fileTriples = [];
        }
      }

      for (const triple of fileTriples) this._accum.push(triple);
      this._processed++;
      this._triples += fileTriples.length;
    }

    this.cursor = end;
  }

  /**
   * Grounds the accumulated code graph into the manifold with structure-derived
   * coordinates (one precept per node, graph-adjacent terms metric-near), then
   * crystallizes each edge as a proof against the final, faithful positions.
   * Runs once, after every file has been parsed - so vault anchors are never
   * computed against provisional coordinates.
   */
  private async _finalizeOnce(
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store: Store,
    maxPlacementNodes: number
  ): Promise<void> {
    if (this._finalized) return;
    this._finalized = true;
    if (this._accum.length === 0) return;

    const { labelToPrecept, placement } = groundAstIntoSystem(
      this._accum,
      system,
      atomizer,
      { seed: 0, maxPlacementNodes }
    );
    if (!placement && labelToPrecept.size > 0) {
      console.warn(
        `[AstSeed] ${labelToPrecept.size} nodes produced no placement - ` +
          `expected only for an empty graph.`
      );
    }

    for (const triple of this._accum) {
      const subjId = labelToPrecept.get(triple.subject);
      const objId = labelToPrecept.get(triple.object);
      if (subjId === undefined || objId === undefined || subjId === objId)
        continue;

      // Demote contradicting prior facts before crystallizing high-energy edges.
      if (triple.energy >= 1.2) {
        try {
          const existing = await store.findContradictingFacts(
            triple.subject,
            triple.predicate
          );
          for (const conflictFact of existing) {
            if (conflictFact !== triple.text) {
              await store.adjustEnergy(
                store.signatureForText(conflictFact),
                -0.5
              );
            }
          }
        } catch {
          // Non-fatal - proceed even if the contradiction check fails.
        }
      }

      await store.crystallizeProof(
        new Uint32Array([subjId]),
        new Uint32Array([objId]),
        triple.energy
      );
      const sig = store.signatureForText(triple.text);
      await store.storeFact(triple.text, "ast", triple.energy, sig);
      // knowledge_state=2 (Learned) - the compiler already "reproduced" these.
      await store.updateKnowledgeState(sig, 2, 3, "ast:parse");
    }
  }
}
