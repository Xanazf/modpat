/**
 * Runtime - the single wiring point for the full ModPAT stack.
 *
 * Contains both the LiveInference orchestrator (intent routing, feedback,
 * inquiry backlog) and the Runtime factory (boot / dispose).
 *
 * Usage:
 *   const rt = await Runtime.boot({ atomizer: "semantic", db: "./data/repl.db" });
 *   const rt = await Runtime.boot({ atomizer: "base" });   // tests, no embeddings
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import SpectralAtomizer from "@atomics/SpectralAtomizer";
import { DOPAT_CONFIG } from "@config";
import { CognitiveLoop } from "@core_i/CognitiveLoop";
import Resolver from "@core_i/Resolver";
import System, { SystemRef } from "@core_i/System";
import { DatabaseContext } from "@core_s/DatabaseContext";
import { SelfConcept } from "@core_s/Identity";
import { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import {
  buildManifoldIndex,
  constellationGaps,
  constellations,
} from "@core_s/ManifoldMetrics";
import Store from "@core_s/Memory";
import { SystemPersistence } from "@core_s/Persistence";
import Unfolder from "@core_s/Unfolder";
import { WorkerPool } from "@core_s/WorkerPool";
import { AstSeedWorker, type AstSeedOptions } from "@core_s/AstSeedWorker";
import { IntentTag, spawnIntent } from "@utils/intentPrecept";
import logger from "@utils/SpectralLogger";
import { extractTopic } from "@utils/topicExtraction";
import { parse } from "abstract-syntax-tree";
import nlp from "compromise";
import Coder from "./Coder";
import { InquiryQueue, Learner } from "./Learner";
import Listener, { isCodeIntent } from "./Listener";
import Talker from "./Talker";
import { buildExplanation, WorkingMemory } from "./WorkingMemory";

// LiveInference

/**
 * AST node types that the Coder knows how to extract patterns from.
 * Must stay in sync with Coder.VISITED_TYPES.
 */
const CODE_NODE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "BinaryExpression",
  "IfStatement",
  "ReturnStatement",
  "VariableDeclaration",
  "CallExpression",
]);

/**
 * Returns true when the input looks like executable code rather than natural language.
 *
 * Two-stage check:
 *  1. Fast heuristic - must contain at least one structural code indicator.
 *  2. AST parse attempt - if the heuristic passes, try to parse; the input is
 *     treated as code only if parsing succeeds AND produces at least one
 *     recognised Coder node type.
 */
function isCodeInput(text: string): boolean {
  if (
    !/[{;]/.test(text) &&
    !/\bfunction\b|\bconst\s+\w|\blet\s+\w|\bvar\s+\w|\bclass\s+\w/.test(text)
  ) {
    return false;
  }
  try {
    const ast = parse(text, { module: false });
    return (ast as any).body.some((node: any) =>
      CODE_NODE_TYPES.has(node.type)
    );
  } catch {
    return false;
  }
}

/**
 * LiveInference routes natural language and code input to the appropriate
 * engine (Listener / Talker / Coder), manages feedback reinforcement, and
 * maintains the Inquiry backlog for proactive follow-up on unknowns.
 */
export class LiveInference {
  private systemRef: SystemRef;
  private store: Store;
  private unfolder: Unfolder;
  private resolver: Resolver;
  private listener: Listener;
  private talker: Talker;
  private coder: Coder;
  private learner: Learner;
  private inquiryQueue: InquiryQueue;
  /** Called when a query resolves to "unknown" - used by CognitiveLoop to spawn Intent. */
  public onUnknown?: (topic: string) => void;
  private workingMemory: WorkingMemory;

  private last_signature: string | null = null;
  private intentCount = 0;

  constructor(
    system: Root.ManifoldView | SystemRef,
    atomizer: Atomic.Engine,
    resolver: Resolver,
    store: Store,
    unfolder?: Unfolder
  ) {
    this.systemRef =
      system instanceof SystemRef
        ? system
        : new SystemRef(system as Root.ManifoldView);
    this.store = store;
    this.resolver = resolver;
    this.unfolder = unfolder || new Unfolder(this.systemRef, atomizer);
    resolver.setUnfolder(this.unfolder);

    this.listener = new Listener(
      this.systemRef,
      atomizer,
      resolver,
      store,
      this.unfolder,
      msg => this.respond(msg)
    );
    this.talker = new Talker(this.systemRef, atomizer, store, msg =>
      this.respond(msg)
    );
    this.coder = new Coder(this.systemRef, atomizer, store, msg =>
      this.respond(msg)
    );
    this.learner = new Learner(
      this.systemRef,
      atomizer,
      resolver,
      store,
      this.unfolder
    );
    this.inquiryQueue = new InquiryQueue(store);
    this.workingMemory = new WorkingMemory();
  }

  public getLearner(): Learner {
    return this.learner;
  }
  public getInquiryQueue(): InquiryQueue {
    return this.inquiryQueue;
  }
  public getWorkingMemory(): WorkingMemory {
    return this.workingMemory;
  }

  public async processIntent(query: string): Promise<string> {
    if (++this.intentCount % 50 === 0) {
      await this.store.cullWeakWaveForms();
    }
    const doc = nlp(query);
    const isQuestion = doc.questions().length > 0 || query.trim().endsWith("?");

    if (/^(no|incorrect|wrong|that'?s wrong|false)\b/i.test(query)) {
      if (this.last_signature) {
        await this.store.adjustEnergy(this.last_signature, -0.5);
        await this.store.adjustUsageCount(this.last_signature, 0);
      }
      // O6 fix: detect corrective form "no, X is Y" and ingest the correction.
      // Pattern: negative prefix + comma/space + a declarative statement.
      const correctionMatch = query.match(
        /^(?:no|incorrect|wrong|false)[,.\s]+(.+)$/i
      );
      if (correctionMatch) {
        const correction = correctionMatch[1].trim();
        if (correction.length > 3) {
          // Ingest the correction as a command - this crystallizes the right answer.
          const correctionResponse = await this.processCommand(correction);
          const response = `Feedback acknowledged. Correction ingested: "${correction}"`;
          this.respond(response);
          return response;
        }
      }
      const response = "Feedback acknowledged. Structural confidence reduced.";
      this.respond(response);
      return response;
    }
    if (/^(yes|correct|right|true)\b/i.test(query)) {
      if (this.last_signature) {
        await this.store.adjustEnergy(this.last_signature, 0.1);
        await this.store.adjustUsageCount(
          this.last_signature,
          DOPAT_CONFIG.memory.FEEDBACK_BOOST
        );
        const response =
          "Feedback acknowledged. Structural confidence increased.";
        this.respond(response);
        return response;
      }
    }

    if (
      isQuestion ||
      query.match(/^(what|who|where|how|why|is|are|can|do|does)\b/i) ||
      isCodeIntent(query)
    ) {
      return this.processQuestion(query);
    } else if (isCodeInput(query)) {
      return this.processCode(query);
    } else {
      return this.processCommand(query);
    }
  }

  public async processQuestion(query: string): Promise<string> {
    // Reference resolution: "it", "this" → most recent conclusion from working memory.
    const resolvedQuery = this.workingMemory.resolveReferences(query);

    // Context seeding: pass scopes through opts so they isolate to this call
    // rather than racing on a shared instance field.
    const ctxScopes = new Set(this.workingMemory.contextScopes());

    const { text: result, diagnostics: diag } =
      await this.listener.processQuestion(resolvedQuery, {
        contextScopes: ctxScopes,
      });
    this.last_signature = this.listener.lastSignature;

    if (
      !result ||
      result.trim() === "unknown" ||
      result.startsWith("[Unfolder]")
    ) {
      // Prefer bridge-derived missing links over generic topic extraction:
      // they come from the bidirectional pass and identify the exact logical gap.
      const missingLinks =
        diag?.bridgeCandidates.filter(c => c.isMissingLink) ?? [];
      if (missingLinks.length > 0) {
        for (const link of missingLinks.slice(0, 2)) {
          this.inquiryQueue.enqueue(link.label, resolvedQuery);
          this.onUnknown?.(link.label);
        }
      } else {
        const topic = extractTopic(resolvedQuery);
        if (topic) {
          this.inquiryQueue.enqueue(topic, resolvedQuery);
          this.onUnknown?.(topic);
        }
      }
    } else {
      this.inquiryQueue.checkForAnswers(resolvedQuery);

      // Record this conclusion in working memory so future turns can reference it.
      const bridges = diag?.bridgeCandidates ?? [];
      const explanation = buildExplanation(bridges, result);
      const conclusionId = diag?.sinkCandidates[0]?.id ?? 0;
      const sys = this.systemRef.current;
      const conclusionScope =
        conclusionId > 0 && sys.isAllocated(conclusionId)
          ? sys.scope[conclusionId]
          : 0;

      this.workingMemory.push({
        query,
        conclusion: result.trim(),
        conclusionScope,
        conclusionId,
        explanation,
      });
    }

    // contextScopes are scoped to the listener call via opts, so there is
    // nothing to clear here - the next turn will rebuild them locally.

    return result;
  }

  public async processCommand(statement: string): Promise<string> {
    const result = await this.talker.processCommand(statement);
    this.last_signature = this.talker.lastSignature;
    this.inquiryQueue.checkForAnswers(statement);

    // Established facts are conclusions too: push the topic to working memory so
    // follow-up questions ("what color is it?") can resolve "it" to the subject.
    const topic = extractTopic(statement);
    if (topic) {
      // Pick the most recent working-memory scope as the best-guess subject
      // scope for the new conclusion. Avoids reading the racy
      // Resolver.contextScopes mirror.
      const recent = this.workingMemory.contextScopes();
      const topicScope = recent.length > 0 ? recent[recent.length - 1] : 0;
      this.workingMemory.push({
        query: statement,
        conclusion: topic,
        conclusionScope: topicScope,
        conclusionId: 0,
        explanation: null,
      });
    }

    return result;
  }

  public async processCode(source: string): Promise<string> {
    return this.coder.processCode(source);
  }

  public respond(response: string): void {
    logger.log(`[LiveInference]: ${response}`);
  }
}

// Runtime

export type AtomizerMode = "semantic" | "base" | "spectral";

export interface RuntimeOptions {
  /** Atomizer to use (default: "semantic"). Automatically falls back to "base" if embeddings are unavailable. */
  atomizer?: AtomizerMode;
  /** DuckDB path (default: ":memory:"). */
  db?: string;
  /** Skip SelfConcept initialisation - useful in test environments that don't need identity axioms. */
  skipIdentity?: boolean;
  /** Called if the requested atomizer fails to load and the runtime falls back to "base". */
  onFallback?: (reason: string) => void;
  /**
   * Disable the automatic maintenance tick (decay + age refresh).
   * Useful in tests that want a fully static manifold.
   * Default: tick is started automatically.
   */
  noTick?: boolean;
  /**
   * Disable full ManifoldLifecycle wrapping (TMR allocator, primary/emergency
   * failover, gravitational consolidation, and dream cycle).
   * Default: lifecycle is active. Set this in unit/stress/perf tests that need
   * a plain System with lightweight decay only.
   */
  noLifecycle?: boolean;
  /**
   * Disable worker threads.  Useful in test environments that don't need
   * off-thread computation and want to avoid the worker startup overhead.
   */
  noWorkers?: boolean;
  /**
   * Root paths to scan for TypeScript/JavaScript source files.
   * When set, an AstSeedWorker is created and started automatically if the
   * manifold is fresh (system.length < 100 precepts at boot).
   * Pass `noWorkers: false` (the default) to offload parsing to ast.worker.
   */
  astSeedPaths?: string[];
  /** Options forwarded to AstSeedWorker.start(). */
  astSeedOptions?: AstSeedOptions;
  /**
   * Interval in ms for the autonomous learner cycle (default: 10 000).
   * The learner samples low-confidence vault facts and promotes them through
   * the challenge loop independently of user input.
   */
  learnerIntervalMs?: number;
  /**
   * Enable the background constellation gap scanner (default: true when lifecycle is active).
   * Set to false to disable proactive curiosity enqueueing.
   */
  proactivity?: boolean;
  /** Gap scan interval in ms (default: 30 000). */
  gapScanIntervalMs?: number;
}

export class Runtime {
  public readonly system: System;
  public readonly atomizer: Atomic.Engine;
  /** Which atomizer mode was actually used (may differ from requested if fallback occurred). */
  public readonly atomizerMode: AtomizerMode;
  public readonly store: Store;
  public readonly resolver: Resolver;
  public readonly unfolder: Unfolder;
  public readonly inference: LiveInference;
  /** The ego-centre precept.  null when skipIdentity was set. */
  public readonly identity: SelfConcept | null;
  /**
   * ManifoldLifecycle instance (active by default unless RuntimeOptions.noLifecycle).
   * Provides TMR allocation, primary/emergency failover, consolidation and
   * dream cycle on top of the plain System.  null when noLifecycle is set.
   */
  public readonly lifecycle: ManifoldLifecycle | null;
  /**
   * Worker pool for off-thread computation: manifold metrics, Wikipedia fetch,
   * and WordNet dictionary lookup.  Shares the System's SharedArrayBuffer
   * with the manifold worker so reads are zero-copy.
   * Null in unit-test boots where no tick / no workers are desired
   * (set RuntimeOptions.noWorkers to suppress).
   */
  public readonly workers: WorkerPool | null;

  /** CognitiveLoop - the autonomous motivation daemon. Active when lifecycle is on. */
  public cognitiveLoop: CognitiveLoop | null = null;
  /** AstSeedWorker - background codebase topology builder. Null unless astSeedPaths was set. */
  public astSeeder: AstSeedWorker | null = null;

  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _learnerTimer: ReturnType<typeof setInterval> | null = null;
  private _gapScanTimer: ReturnType<typeof setInterval> | null = null;
  private _inquiryDrainTimer: ReturnType<typeof setInterval> | null = null;
  private _gapSeen = new Set<string>();
  private _tickIntervalMs = 0;
  private _lifecycleCtx: DatabaseContext | null = null;
  /**
   * Background tasks kicked off in boot() — inquiry-queue hydration and the
   * syllogism seed. dispose() awaits this before closing the store so a
   * fast-path dispose never races their DuckDB prepare() calls.
   */
  private _bootBackground: Promise<void> = Promise.resolve();
  /** Set true once dispose() begins so any in-flight boot task can early-out. */
  private _disposed = false;

  /**
   * Resolves when both fire-and-forget boot tasks (inquiry-queue restore and
   * syllogism seed) have settled. Callers that need a fully-warm Runtime can
   * `await rt.ready` after boot returns.
   */
  get ready(): Promise<void> {
    return this._bootBackground;
  }

  private constructor(fields: {
    system: System;
    atomizer: Atomic.Engine;
    atomizerMode: AtomizerMode;
    store: Store;
    resolver: Resolver;
    unfolder: Unfolder;
    inference: LiveInference;
    identity: SelfConcept | null;
    lifecycle?: ManifoldLifecycle | null;
    lifecycleCtx?: DatabaseContext | null;
    workers?: WorkerPool | null;
  }) {
    this.system = fields.system;
    this.atomizer = fields.atomizer;
    this.atomizerMode = fields.atomizerMode;
    this.store = fields.store;
    this.resolver = fields.resolver;
    this.unfolder = fields.unfolder;
    this.inference = fields.inference;
    this.identity = fields.identity;
    this.lifecycle = fields.lifecycle ?? null;
    this._lifecycleCtx = fields.lifecycleCtx ?? null;
    this.workers = fields.workers ?? null;
  }

  /**
   * Constructs and wires the full stack:
   *   System → Atomizer → Store → Resolver → Unfolder → LiveInference → SelfConcept
   */
  static async boot(opts: RuntimeOptions = {}): Promise<Runtime> {
    const system = new System();

    // Atomizer
    let atomizer: Atomic.Engine;
    let atomizerMode: AtomizerMode = opts.atomizer ?? "semantic";

    switch (atomizerMode) {
      case "semantic": {
        const sem = new SemanticAtomizer();
        try {
          await sem.init();
          atomizer = sem;
        } catch (e: any) {
          opts.onFallback?.(e.message);
          atomizerMode = "base";
          const log = new LogicAtomizer();
          await log.init();
          atomizer = log;
        }
        break;
      }
      case "spectral": {
        const spec = new SpectralAtomizer();
        await spec.init();
        atomizer = spec;
        break;
      }
      default: {
        const log = new LogicAtomizer();
        await log.init();
        atomizer = log;
        break;
      }
    }

    // Store
    const store = new Store(system, atomizer, opts.db);
    await store.waitForInit();

    // Resolver + Unfolder + LiveInference
    const resolver = new Resolver(system, atomizer, store);
    const unfolder = new Unfolder(system, atomizer);
    const inference = new LiveInference(
      system,
      atomizer,
      resolver,
      store,
      unfolder
    );

    // Identity (optional)
    let identity: SelfConcept | null = null;
    if (!opts.skipIdentity) {
      identity = new SelfConcept();
      await identity.initialize(system, atomizer, store);
    }

    // ManifoldLifecycle (optional)
    // When lifecycle: true, wraps the system in full TMR allocation, primary +
    // emergency failover, gravitational consolidation, and dream cycle.
    let lifecycle: ManifoldLifecycle | null = null;
    let lifecycleCtx: DatabaseContext | null = null;
    if (!opts.noLifecycle) {
      const emergency = new System();
      // Use a separate in-memory DB for lifecycle persistence (snapshots/hydration).
      lifecycleCtx = new DatabaseContext(":memory:");
      const lifecycleConn = await lifecycleCtx.connect();
      const lifecyclePersistence = new SystemPersistence(lifecycleConn);
      lifecycle = new ManifoldLifecycle(
        system,
        emergency,
        lifecyclePersistence
      );
      lifecycle.setUnfolder(unfolder);
    }

    // WorkerPool: off-thread manifold metrics, Wikipedia fetch, WordNet lookup.
    let workers: WorkerPool | null = null;
    if (!opts.noWorkers) {
      workers = new WorkerPool(system.buffer, system.getLayout());
      // Route wiki fetches through the isolated wiki worker.
      unfolder.setWikiDelegate(topic => workers!.fetchWikipedia(topic));
    }

    const rt = new Runtime({
      system,
      atomizer,
      atomizerMode,
      store,
      resolver,
      unfolder,
      inference,
      identity,
      lifecycle,
      lifecycleCtx,
      workers,
    });

    // Wire the Cognitive Daemon (lifecycle active by default).
    if (!opts.noLifecycle) {
      rt.cognitiveLoop = new CognitiveLoop(rt);
      // Hook InquiryQueue.enqueue → spawn Intent precept
      rt.inference.getInquiryQueue().onEnqueue = (topic: string) => {
        rt.cognitiveLoop!.spawnAndRegister(topic, 2.0, IntentTag.INQUIRY_GAP);
      };
      // Hook processQuestion unknown result → spawn USER_UNKNOWN Intent
      rt.inference.onUnknown = (topic: string) => {
        rt.cognitiveLoop!.spawnAndRegister(topic, 3.0, IntentTag.USER_UNKNOWN);
      };
    }

    // Wire the AST seeder if root paths were specified.
    if (opts.astSeedPaths?.length) {
      rt.astSeeder = new AstSeedWorker(opts.astSeedPaths);
      // Auto-start on a fresh manifold (nothing seeded yet).
      if (system.length < 100) {
        rt.astSeeder.start(system, atomizer, store, {
          ...opts.astSeedOptions,
          pool: workers ?? undefined,
        });
      }
    }

    if (!opts.noTick) {
      rt.startTick(undefined, {
        learnerIntervalMs: opts.learnerIntervalMs,
        proactivity: opts.proactivity,
        gapScanIntervalMs: opts.gapScanIntervalMs,
      });
    }

    // Restore any unresolved inquiries from the previous session, and seed
    // canonical syllogism templates so Phase 0b vault recall handles them
    // before falling through to the hard-coded NLP rules in Phase 1.
    //
    // Both run in the background, but the combined promise is stored on the
    // Runtime so dispose() can await them before closing the store. Without
    // this, a fast dispose() races their DuckDB prepare() calls and emits
    // "connection disconnected" warnings.
    const restoreInquiries = store
      .loadInquiryQueue()
      .then(items => {
        if (!rt._disposed) rt.inference.getInquiryQueue().populate(items);
      })
      .catch(e => {
        if (!rt._disposed) logger.warn("[INQUIRY LOAD]", e);
      });

    const seedTemplates = Runtime._seedSyllogisms(
      store,
      atomizer,
      system,
      () => rt._disposed
    ).catch(e => {
      if (!rt._disposed) logger.warn("[SYLLOGISM SEED]", e);
    });

    rt._bootBackground = Promise.all([restoreInquiries, seedTemplates]).then(
      () => undefined
    );

    return rt;
  }

  /**
   * Starts the lightweight maintenance tick: decays atom masses and temporal
   * freshness (posW) on every interval.  Called automatically by boot() unless
   * RuntimeOptions.noTick is set.
   *
   * The tick intentionally does not run consolidation, dream cycle, or TMR -
   * those live in ManifoldLifecycle for advanced deployments.  This tick provides
   * the minimum needed for temporal ordering to mean anything: decay and age.
   */
  startTick(
    intervalMs: number = DOPAT_CONFIG.observability.TICK_INTERVAL_MS,
    opts: Pick<
      RuntimeOptions,
      "learnerIntervalMs" | "proactivity" | "gapScanIntervalMs"
    > = {}
  ): void {
    if (this._tickTimer !== null) return;
    this._tickIntervalMs = intervalMs;
    this._tickTimer = setInterval(() => {
      if (this.lifecycle) {
        // Full lifecycle tick: TMR maintenance, decay, consolidation, dream cycle.
        this.lifecycle.tick(intervalMs);
      } else {
        // Lightweight tick: decay + age freshness only.
        this.system.decay(intervalMs);
      }
    }, intervalMs);

    // Autonomous learner cycle - runs independently of user input.
    const learnerMs = opts.learnerIntervalMs ?? 10_000;
    this._learnerTimer = setInterval(() => {
      this.inference
        .getLearner()
        .runCycle(5)
        .catch(e => logger.warn("[LEARNER TIMER]", e));
    }, learnerMs);

    // Start the Cognitive Daemon.
    this.cognitiveLoop?.start();

    // Background constellation gap scanner (requires lifecycle / workers).
    const proactive = opts.proactivity !== false && this.lifecycle !== null;
    if (proactive) {
      const scanMs = opts.gapScanIntervalMs ?? 30_000;
      this._gapScanTimer = setInterval(
        () => this._runGapScan().catch(e => logger.warn("[GAP SCAN]", e)),
        scanMs
      );

      // Autonomous InquiryQueue draining - works through pending topics at 5 s cadence.
      this._inquiryDrainTimer = setInterval(() => {
        this.inference
          .getInquiryQueue()
          .step(
            3,
            this.unfolder,
            this.resolver,
            this.system,
            this.atomizer,
            this.store
          )
          .catch(e => logger.warn("[INQUIRY DRAIN]", e));
      }, 5_000);
    }
  }

  stopTick(): void {
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    if (this._learnerTimer !== null) {
      clearInterval(this._learnerTimer);
      this._learnerTimer = null;
    }
    if (this._gapScanTimer !== null) {
      clearInterval(this._gapScanTimer);
      this._gapScanTimer = null;
    }
    if (this._inquiryDrainTimer !== null) {
      clearInterval(this._inquiryDrainTimer);
      this._inquiryDrainTimer = null;
    }
    this.cognitiveLoop?.stop();
  }

  get isTickRunning(): boolean {
    return this._tickTimer !== null;
  }

  get tickIntervalMs(): number {
    return this._tickIntervalMs;
  }

  /**
   * Seeds canonical logical syllogism templates into the vault at high energy
   * so Phase 0b vault recall handles them before the hard-coded Phase 1 NLP rules.
   * Idempotent: templates already present (by signature) are skipped.
   *
   * @param cancelled Predicate polled between awaits. When it returns true,
   *                  the seeder exits cleanly without further DuckDB writes —
   *                  used so dispose() can stop seeding before closing the
   *                  store rather than swallowing "connection disconnected".
   */
  private static async _seedSyllogisms(
    store: Store,
    atomizer: Atomic.Engine,
    system: System,
    cancelled: () => boolean = () => false
  ): Promise<void> {
    // Template definitions: [premise text, conclusion text, energy]
    // Energy 5.0 is well above normal vault entries (~1.0) so they rank first.
    const templates: Array<[string, string, number]> = [
      // Transitivity: A is B; B is C |- A is C
      ["A is B B is C |-", "A is C", 5.0],
      // Universal instantiation: All A are B; X is A |- X is B
      ["All A are B X is A |-", "X is B", 5.0],
      // Contrapositive: A implies B; not B |- not A
      ["A implies B not B |-", "not A", 5.0],
      // Existence: A was created in D |- A did not exist before D
      ["A was created in D |-", "A did not exist before D", 5.0],
    ];

    for (const [premiseText, conclusionText, energy] of templates) {
      if (cancelled()) return;
      try {
        const premiseIds = atomizer.ingestSequence(premiseText, system);
        const hit = await store.checkInterferencePattern(premiseIds);
        if (cancelled()) return;
        if (hit) continue; // already seeded
        const conclusionIds = atomizer.ingestSequence(conclusionText, system);
        await store.crystallizeProof(premiseIds, conclusionIds, energy);
        logger.debug(
          `[SYLLOGISM SEED] seeded: "${premiseText}" → "${conclusionText}"`
        );
      } catch (e) {
        // Suppress noise if we're already tearing down — those errors are
        // expected ("connection disconnected") and not actionable.
        if (cancelled()) return;
        logger.warn("[SYLLOGISM SEED] failed for template:", premiseText, e);
      }
    }
  }

  /**
   * Scans constellation gaps and enqueues any new strained atom pairs as
   * inquiry topics.  Skips pairs seen in the current scan window (_gapSeen).
   */
  private async _runGapScan(): Promise<void> {
    try {
      const queue = this.inference.getInquiryQueue();
      let rows: Array<{ labelA: string; labelB: string }> = [];

      if (this.workers) {
        const cs = await this.workers.computeConstellations(this.system.length);
        const filtered = cs.filter(g => g.members.length >= 3).slice(0, 15);
        if (filtered.length === 0) return;
        const rawGaps = await this.workers.computeGaps(
          filtered,
          this.system.length
        );
        rows = rawGaps.slice(0, 2).map(g => ({
          labelA: this.atomizer.resolveScope(this.system.scope[g.atomA]) ?? "?",
          labelB: this.atomizer.resolveScope(this.system.scope[g.atomB]) ?? "?",
        }));
      } else {
        const idx = buildManifoldIndex(this.system);
        const cs = constellations(this.system, { minSize: 3, index: idx });
        if (cs.length === 0) return;
        const gaps = constellationGaps(
          this.system,
          cs.slice(0, 15),
          this.atomizer,
          {
            maxPerConstellation: 1,
            minMassRatio: 0.05,
          }
        );
        rows = gaps
          .slice(0, 2)
          .map(g => ({ labelA: g.labelA, labelB: g.labelB }));
      }

      // Clear seen set at the start of each scan so pairs can be re-evaluated
      // after enough time has passed for new structure to emerge.
      this._gapSeen.clear();

      for (const r of rows) {
        const key = `${r.labelA}:${r.labelB}`;
        if (this._gapSeen.has(key)) continue;
        this._gapSeen.add(key);
        const query = `What is the relationship between ${r.labelA} and ${r.labelB}?`;
        queue.enqueue(r.labelA, query);
        // Spawn a CONSTELLATION_GAP Intent precept for the Cognitive Daemon.
        this.cognitiveLoop?.spawnAndRegister(
          r.labelA,
          1.5,
          IntentTag.CONSTELLATION_GAP
        );
      }
    } catch {
      // Gap scan is non-critical; swallow errors silently.
    }
  }

  /** Releases GPU resources, stops the tick, closes database connections, and terminates workers. */
  async dispose(): Promise<void> {
    // Flag boot-background tasks (syllogism seed, inquiry-queue restore) to
    // bail out at their next checkpoint so they don't reach a closed store.
    this._disposed = true;
    this.stopTick();
    // Drain any in-flight boot-background work before closing the store.
    // Their per-step cancellation check sees _disposed and exits cleanly;
    // we still await so a fast dispose() doesn't race the DuckDB prepare().
    await this._bootBackground.catch(() => {});
    await this.resolver.dispose();
    await this.store.close();
    if (this._lifecycleCtx) await this._lifecycleCtx.close();
    if (this.workers) await this.workers.dispose();
  }
}

export default Runtime;
