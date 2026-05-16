/**
 * Runtime — the single wiring point for the full ModPAT stack.
 *
 * Contains both the LiveInference orchestrator (intent routing, feedback,
 * inquiry backlog) and the Runtime factory (boot / dispose).
 *
 * Usage:
 *   const rt = await Runtime.boot({ atomizer: "semantic", db: "./data/repl.db" });
 *   const rt = await Runtime.boot({ atomizer: "base" });   // tests, no embeddings
 */

import nlp from "compromise";
import { parse } from "abstract-syntax-tree";
import { DOPAT_CONFIG } from "@config";
import System, { SystemRef } from "@core_i/System";
import { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import { DatabaseContext } from "@core_s/DatabaseContext";
import { SystemPersistence } from "@core_s/Persistence";
import Resolver from "@core_i/Resolver";
import { SelfConcept } from "@core_s/Identity";
import LogicAtomizer from "@atomics/LogicAtomizer";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import SpectralAtomizer from "@atomics/SpectralAtomizer";
import Store from "@core_s/Memory";
import Unfolder from "@core_s/Unfolder";
import logger from "@utils/SpectralLogger";
import Listener, { isCodeIntent } from "./Listener";
import Talker from "./Talker";
import Coder from "./Coder";
import { Learner, InquiryQueue } from "./Learner";
import { WorkingMemory, buildExplanation } from "./WorkingMemory";

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
 *  1. Fast heuristic — must contain at least one structural code indicator.
 *  2. AST parse attempt — if the heuristic passes, try to parse; the input is
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
    this.inquiryQueue = new InquiryQueue();
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
    if (this.intentCount % 20 === 0) {
      this.learner.runCycle(5).catch(() => {});
    }
    const doc = nlp(query);
    const isQuestion = doc.questions().length > 0 || query.trim().endsWith("?");

    if (/^(no|incorrect|wrong|that'?s wrong|false)\b/i.test(query)) {
      if (this.last_signature) {
        await this.store.adjustEnergy(this.last_signature, -0.5);
        await this.store.adjustUsageCount(this.last_signature, 0);
        const response =
          "Feedback acknowledged. Structural confidence reduced.";
        this.respond(response);
        return response;
      }
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

    // Context seeding: tell the Resolver which scopes are "warm" from recent turns.
    this.resolver.contextScopes = new Set(this.workingMemory.contextScopes());

    const result = await this.listener.processQuestion(resolvedQuery);
    this.last_signature = this.listener.lastSignature;

    const diag = this.resolver.lastDiagnostics;

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
        }
      } else {
        const topic = this.extractTopic(resolvedQuery);
        if (topic) this.inquiryQueue.enqueue(topic, resolvedQuery);
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

    // Clear context scopes — next turn will rebuild from updated working memory.
    this.resolver.contextScopes = new Set();

    return result;
  }

  public async processCommand(statement: string): Promise<string> {
    const result = await this.talker.processCommand(statement);
    this.last_signature = this.talker.lastSignature;
    this.inquiryQueue.checkForAnswers(statement);

    // Established facts are conclusions too: push the topic to working memory so
    // follow-up questions ("what color is it?") can resolve "it" to the subject.
    const topic = this.extractTopic(statement);
    if (topic) {
      const sys = this.systemRef.current;
      const topicScope =
        this.resolver.contextScopes.size === 0
          ? 0
          : [...this.resolver.contextScopes][0]; // best guess at the topic scope
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

  private extractTopic(query: string): string {
    const stop = new Set([
      "what",
      "who",
      "where",
      "when",
      "why",
      "how",
      "is",
      "am",
      "are",
      "was",
      "were",
      "a",
      "an",
      "the",
      "it",
      "its",
      "this",
      "that",
      "do",
      "does",
      "did",
      "can",
      "will",
      "would",
      "could",
      "should",
      "i",
      "me",
      "my",
      "you",
      "your",
      "we",
      "our",
    ]);
    const tokens = query
      .replace(/[?|!|-]+$/g, "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2 && !stop.has(t));
    return tokens.sort((a, b) => b.length - a.length)[0] ?? "";
  }
}

// Runtime

export type AtomizerMode = "semantic" | "base" | "spectral";

export interface RuntimeOptions {
  /** Atomizer to use (default: "semantic"). Automatically falls back to "base" if embeddings are unavailable. */
  atomizer?: AtomizerMode;
  /** DuckDB path (default: ":memory:"). */
  db?: string;
  /** Skip SelfConcept initialisation — useful in test environments that don't need identity axioms. */
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
   * Enable full ManifoldLifecycle wrapping: Triple-Modular Redundancy allocator,
   * primary + emergency system failover, gravitational consolidation, and dream
   * cycle (background topic expansion via the Unfolder).
   * Default: plain System with lightweight decay tick only.
   */
  lifecycle?: boolean;
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
   * ManifoldLifecycle instance when RuntimeOptions.lifecycle was set.
   * Provides TMR allocation, primary/emergency failover, consolidation and
   * dream cycle on top of the plain System.  null in the default boot path.
   */
  public readonly lifecycle: ManifoldLifecycle | null;

  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _tickIntervalMs = 0;
  private _lifecycleCtx: DatabaseContext | null = null;

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
    if (opts.lifecycle) {
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
    });

    if (!opts.noTick) {
      rt.startTick();
    }

    return rt;
  }

  /**
   * Starts the lightweight maintenance tick: decays atom masses and temporal
   * freshness (posW) on every interval.  Called automatically by boot() unless
   * RuntimeOptions.noTick is set.
   *
   * The tick intentionally does not run consolidation, dream cycle, or TMR —
   * those live in ManifoldLifecycle for advanced deployments.  This tick provides
   * the minimum needed for temporal ordering to mean anything: decay and age.
   */
  startTick(
    intervalMs: number = DOPAT_CONFIG.observability.TICK_INTERVAL_MS
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
  }

  stopTick(): void {
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  get isTickRunning(): boolean {
    return this._tickTimer !== null;
  }

  get tickIntervalMs(): number {
    return this._tickIntervalMs;
  }

  /** Releases GPU resources, stops the tick, and closes database connections. */
  async dispose(): Promise<void> {
    this.stopTick();
    await this.resolver.dispose();
    await this.store.close();
    if (this._lifecycleCtx) await this._lifecycleCtx.close();
  }
}

export default Runtime;
