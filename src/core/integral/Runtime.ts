/**
 * Runtime - the single wiring point for the full ModPAT stack.
 *
 * After the "Mapper as Thinker" Phase 6 refactor:
 *   - Mapper is THE thinker (perception + locomotion + learning + motivation)
 *   - Language is the translation boundary
 *   - Runtime is boot/wiring only; no reasoning logic lives here
 *
 * Usage:
 *   const rt = await Runtime.boot({ atomizer: "semantic", db: "./data/repl.db" });
 *   await rt.mapper.process("the sky is blue");
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import SpectralAtomizer from "@atomics/SpectralAtomizer";
import { DOPAT_CONFIG } from "@config";
import { CognitiveLoop } from "@core_i/CognitiveLoop";
import Mapper from "@core_i/Mapper";
import Resolver from "@core_i/Resolver";
import System, { OperatorClass, SystemRef } from "@core_i/System";
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
import { IntentTag } from "@utils/intentPrecept";
import logger from "@utils/SpectralLogger";
import Language from "./language/Language";
import { createCoderSkill } from "./skills/Coder";
import type { SkillHandler } from "./skills";

// ---------------------------------------------------------------------------
// Default skill wiring
// ---------------------------------------------------------------------------

/**
 * Registers the four standard skills (LANGUAGE, ASSERTION, CODE, ARITHMETIC)
 * on a Mapper instance. Called at boot time by Runtime.boot() and by
 * createTestMapper() for test environments.
 */
function _registerDefaultSkills(
  mapper: Mapper,
  language: Language,
  store: Store,
  atomizer: Atomic.Engine
): void {
  // LANGUAGE skill — perceiveCoherent with arithmetic fast-path
  const langId = atomizer.getSymbolScope("SKILL:LANGUAGE", false);
  const languageHandler: SkillHandler = async ctx => {
    const ir = ctx.ingestResult;
    if (ir?.isArithmeticQuery && ir.attractionCenter) {
      const arith = ctx.language.computeArithmetic(ir.attractionCenter);
      if (arith !== null) {
        ctx.language.respond(arith);
        return { answer: arith, confidence: 1.0 };
      }
    }
    const opts = { contextScopes: ctx.language.contextScopes() };
    const result = await mapper.perceiveCoherent(ctx.queryIds, opts);
    const decoded = ctx.atomizer.decodeSequence(result.ids, ctx.system).trim();

    // Detect physics echo: when perception can't converge, the physics pass
    // returns the input tokens as sinkCandidates. If the result IDs heavily
    // overlap with the query IDs, there's no real answer — return "unknown"
    // so the Mapper's inquiry path can take over (mirrors old Listener behaviour).
    if (decoded && decoded !== "unknown" && result.ids.length > 0) {
      const querySet = new Set(Array.from(ctx.queryIds));
      let overlap = 0;
      for (const id of result.ids) {
        if (querySet.has(id)) overlap++;
      }
      if (overlap / result.ids.length > 0.5) {
        return { answer: "unknown", confidence: 0 };
      }
    }

    return { answer: decoded || "unknown", confidence: result.coherence };
  };
  mapper.registerSkill(langId, languageHandler);

  // ASSERTION skill — ingest declarative statement into vault
  const assertionId = atomizer.getSymbolScope("SKILL:ASSERTION", false);
  const assertionHandler: SkillHandler = async ctx => {
    const answer = await ctx.language.ingestAssertion(ctx.query, ctx.queryIds);
    return { answer, confidence: 1.0 };
  };
  mapper.registerSkill(assertionId, assertionHandler);

  // CODE skill — code synthesis / ingestion
  const coderReg = createCoderSkill(
    atomizer,
    store,
    atomizer.getSymbolScope("SKILL:CODE", false)
  );
  mapper.registerSkill(coderReg.preceptId, coderReg.handler);

  // ARITHMETIC skill — numeric expressions (fast numeric path)
  const arithmeticId = atomizer.getSymbolScope("SKILL:ARITHMETIC", false);
  const arithmeticHandler: SkillHandler = async ctx => {
    const ir = ctx.ingestResult;
    if (ir?.isArithmeticQuery && ir.attractionCenter) {
      const arith = ctx.language.computeArithmetic(ir.attractionCenter);
      if (arith !== null) return { answer: arith, confidence: 1.0 };
    }
    const opts = { contextScopes: ctx.language.contextScopes() };
    const result = await mapper.perceiveCoherent(ctx.queryIds, opts);
    const decoded = ctx.atomizer.decodeSequence(result.ids, ctx.system).trim();
    return { answer: decoded || "unknown", confidence: result.coherence };
  };
  mapper.registerSkill(arithmeticId, arithmeticHandler);
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

/**
 * Creates a configured Mapper with Language and standard skills wired.
 * Intended for test environments that need to create a standalone inference
 * engine without going through Runtime.boot().
 *
 * @deprecated For production use Runtime.boot() and access rt.mapper directly.
 */
export function createTestMapper(
  system: Root.ManifoldView | SystemRef,
  atomizer: Atomic.Engine,
  resolverOrMapper: Mapper,
  store: Store,
  unfolder?: Unfolder
): Mapper {
  const lang = new Language(system, atomizer, { store });
  resolverOrMapper.setLanguage(lang);
  if (unfolder) resolverOrMapper.setUnfolder(unfolder);
  _registerDefaultSkills(resolverOrMapper, lang, store, atomizer);
  return resolverOrMapper;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

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
   */
  astSeedPaths?: string[];
  /** Options forwarded to AstSeedWorker.start(). */
  astSeedOptions?: AstSeedOptions;
  /**
   * Interval in ms for the autonomous learner cycle (default: 10 000).
   * Handled by Mapper.startAutonomy() internally.
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
  /**
   * The Mapper - the single thinker (perception + locomotion + learning + motivation).
   * All text input should go through `mapper.process(text)`.
   */
  public readonly mapper: Mapper;
  /**
   * The Language layer - translation between raw text and the manifold.
   * Use `language.setRespond(cb)` to receive responses from mapper.process().
   */
  public readonly language: Language;
  /** @deprecated Use {@link mapper} instead. */
  public readonly resolver: Resolver;
  /**
   * @deprecated Use {@link mapper} instead.
   * Kept as a deprecated alias so existing code using `rt.inference.processX()`
   * keeps compiling; `mapper` has deprecated `processX` aliases that delegate
   * to `mapper.process()`.
   */
  get inference(): Mapper {
    return this.mapper;
  }
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
   * Null in unit-test boots where no workers are desired.
   */
  public readonly workers: WorkerPool | null;
  public readonly unfolder: Unfolder;

  /** CognitiveLoop - the autonomous motivation daemon. Active when lifecycle is on. */
  public cognitiveLoop: CognitiveLoop | null = null;
  /** AstSeedWorker - background codebase topology builder. Null unless astSeedPaths was set. */
  public astSeeder: AstSeedWorker | null = null;

  private _tickTimer: ReturnType<typeof setInterval> | null = null;
  private _gapScanTimer: ReturnType<typeof setInterval> | null = null;
  private _inquiryDrainTimer: ReturnType<typeof setInterval> | null = null;
  private _gapSeen = new Set<string>();
  private _tickIntervalMs = 0;
  private _lifecycleCtx: DatabaseContext | null = null;
  /**
   * Background tasks kicked off in boot() - inquiry-queue hydration and the
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
    mapper: Mapper;
    language: Language;
    unfolder: Unfolder;
    identity: SelfConcept | null;
    lifecycle?: ManifoldLifecycle | null;
    lifecycleCtx?: DatabaseContext | null;
    workers?: WorkerPool | null;
  }) {
    this.system = fields.system;
    this.atomizer = fields.atomizer;
    this.atomizerMode = fields.atomizerMode;
    this.store = fields.store;
    this.mapper = fields.mapper;
    this.language = fields.language;
    this.resolver = fields.mapper as unknown as Resolver;
    this.unfolder = fields.unfolder;
    this.identity = fields.identity;
    this.lifecycle = fields.lifecycle ?? null;
    this._lifecycleCtx = fields.lifecycleCtx ?? null;
    this.workers = fields.workers ?? null;
  }

  /**
   * Constructs and wires the full stack:
   *   System → Atomizer → Store → Mapper → Language → Skills → SelfConcept
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

    // Mapper + Language + Unfolder
    const mapper = new Mapper(system, atomizer, store);
    const language = new Language(system, atomizer, { store });
    mapper.setLanguage(language);

    const unfolder = new Unfolder(system, atomizer);
    mapper.setUnfolder(unfolder);

    // Register standard skills
    _registerDefaultSkills(mapper, language, store, atomizer);

    // Identity (optional)
    let identity: SelfConcept | null = null;
    if (!opts.skipIdentity) {
      identity = new SelfConcept();
      await identity.initialize(system, atomizer, store);
    }

    // ManifoldLifecycle (optional)
    let lifecycle: ManifoldLifecycle | null = null;
    let lifecycleCtx: DatabaseContext | null = null;
    if (!opts.noLifecycle) {
      const emergency = new System();
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

    // WorkerPool
    let workers: WorkerPool | null = null;
    if (!opts.noWorkers) {
      workers = new WorkerPool(system.buffer, system.getLayout());
      unfolder.setWikiDelegate(topic => workers!.fetchWikipedia(topic));
    }

    const rt = new Runtime({
      system,
      atomizer,
      atomizerMode,
      store,
      mapper,
      language,
      unfolder,
      identity,
      lifecycle,
      lifecycleCtx,
      workers,
    });

    // Wire the Cognitive Daemon (lifecycle active by default).
    if (!opts.noLifecycle) {
      rt.cognitiveLoop = new CognitiveLoop(rt);
      // Hook Mapper unknown result → spawn USER_UNKNOWN Intent
      mapper.onUnknown = (topic: string) => {
        rt.cognitiveLoop!.spawnAndRegister(topic, 3.0, IntentTag.USER_UNKNOWN);
      };
    }

    // Wire Mapper InquiryQueue → spawn Intent precept on enqueue
    mapper.getInquiryQueue().onEnqueue = (topic: string) => {
      if (rt.cognitiveLoop) {
        rt.cognitiveLoop.spawnAndRegister(topic, 2.0, IntentTag.INQUIRY_GAP);
      }
    };

    // Seed Capability Precepts
    const seedCapabilities = async () => {
      const sys = rt.system;
      const atom = rt.atomizer;

      const seed = (name: string, x: number, y: number, z: number) => {
        const id = atom.getSymbolScope(name, false);
        if (sys.isAllocated(id)) return;
        sys.allocated[id] = 1;
        if (id >= sys.length) sys.length = id + 1;
        sys.mass[id] = sys.c ** 2 * 10;
        sys.scope[id] = 1.0;
        sys.depth[id] = 1.0;
        sys.time[id] = 1.0;
        sys.posX[id] = x;
        sys.posY[id] = y;
        sys.posZ[id] = z;
        sys.posW[id] = 0;
        sys.decayRate[id] = 0;
        sys.operatorClass[id] = OperatorClass.Capability;
      };

      seed("SKILL:LANGUAGE", 25, 0.5, 0.5);
      seed("SKILL:ASSERTION", 15, 0.3, 0.3);
      seed("SKILL:CODE", 60, 1.0, 2.0);
      seed("SKILL:ARITHMETIC", 5, 0.1, 0.1);
    };

    // Wire the AST seeder if root paths were specified.
    if (opts.astSeedPaths?.length) {
      rt.astSeeder = new AstSeedWorker(opts.astSeedPaths);
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

    const restoreInquiries = store
      .loadInquiryQueue()
      .then(items => {
        if (!rt._disposed) mapper.getInquiryQueue().populate(items);
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

    const seedCapabilitiesTask = seedCapabilities().catch(e => {
      if (!rt._disposed) logger.warn("[CAPABILITY SEED]", e);
    });

    rt._bootBackground = Promise.all([
      restoreInquiries,
      seedTemplates,
      seedCapabilitiesTask,
    ]).then(() => undefined);

    return rt;
  }

  /**
   * Starts the lightweight maintenance tick: decays atom masses and temporal
   * freshness (posW) on every interval.  Called automatically by boot() unless
   * RuntimeOptions.noTick is set.
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
        this.lifecycle.tick(intervalMs);
      } else {
        this.system.decay(intervalMs);
      }
    }, intervalMs);

    // Delegate learner cycle + cognitive tick to Mapper.startAutonomy().
    // CognitiveLoop.start() calls mapper.startAutonomy() via the shim when
    // lifecycle is active; call it directly when lifecycle is off so the
    // learner still runs in lightweight boots.
    if (this.cognitiveLoop) {
      this.cognitiveLoop.start();
    } else {
      this.mapper.startAutonomy({
        learnerIntervalMs: opts.learnerIntervalMs ?? 10_000,
      });
    }

    // Background constellation gap scanner (requires lifecycle).
    const proactive = opts.proactivity !== false && this.lifecycle !== null;
    if (proactive) {
      const scanMs = opts.gapScanIntervalMs ?? 30_000;
      this._gapScanTimer = setInterval(
        () => this._runGapScan().catch(e => logger.warn("[GAP SCAN]", e)),
        scanMs
      );

      // Autonomous InquiryQueue draining via Mapper.drainInquiries().
      this._inquiryDrainTimer = setInterval(() => {
        this.mapper
          .drainInquiries(3)
          .catch(e => logger.warn("[INQUIRY DRAIN]", e));
      }, 5_000);
    }
  }

  stopTick(): void {
    if (this._tickTimer !== null) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    if (this._gapScanTimer !== null) {
      clearInterval(this._gapScanTimer);
      this._gapScanTimer = null;
    }
    if (this._inquiryDrainTimer !== null) {
      clearInterval(this._inquiryDrainTimer);
      this._inquiryDrainTimer = null;
    }
    // Stop Mapper's autonomous cycles (learner + cognitive tick).
    if (this.cognitiveLoop) {
      this.cognitiveLoop.stop();
    } else {
      this.mapper.stopAutonomy();
    }
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
   */
  private static async _seedSyllogisms(
    store: Store,
    atomizer: Atomic.Engine,
    system: System,
    cancelled: () => boolean = () => false
  ): Promise<void> {
    const templates: Array<[string, string, number]> = [
      ["A is B B is C |-", "A is C", 5.0],
      ["All A are B X is A |-", "X is B", 5.0],
      ["A implies B not B |-", "not A", 5.0],
      ["A was created in D |-", "A did not exist before D", 5.0],
      ["A after B B after C |-", "A after C", 5.0],
    ];

    for (let n = 0; n <= 99; n++) {
      templates.push([`after ${n} is |-`, `${n + 1}`, 5.0]);
    }

    for (let n = 0; n <= 99; n++) {
      templates.push([`${n} plus 1 equals |-`, `${n + 1}`, 5.0]);
    }

    for (const [premiseText, conclusionText, energy] of templates) {
      if (cancelled()) return;
      try {
        const premiseIds = atomizer.ingestSequence(premiseText, system);
        const hit = await store.checkInterferencePattern(premiseIds);
        if (cancelled()) return;
        if (hit) continue;
        const conclusionIds = atomizer.ingestSequence(conclusionText, system);
        await store.crystallizeProof(premiseIds, conclusionIds, energy);
        logger.debug(
          `[SYLLOGISM SEED] seeded: "${premiseText}" → "${conclusionText}"`
        );
      } catch (e) {
        if (cancelled()) return;
        logger.warn("[SYLLOGISM SEED] failed for template:", premiseText, e);
      }
    }
  }

  /**
   * Scans constellation gaps and enqueues any new strained atom pairs as
   * inquiry topics via Mapper.enqueueInquiry().
   */
  private async _runGapScan(): Promise<void> {
    try {
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

      for (const r of rows) {
        const key = `${r.labelA}:${r.labelB}`;
        if (this._gapSeen.has(key)) continue;
        this._gapSeen.add(key);
        const query = `What is the relationship between ${r.labelA} and ${r.labelB}?`;
        this.mapper.enqueueInquiry(r.labelA, query);
        this.mapper.spawnIntent(r.labelA, 1.5, IntentTag.CONSTELLATION_GAP);
      }
    } catch {
      // Gap scan is non-critical; swallow errors silently.
    }
  }

  /** Releases GPU resources, stops the tick, closes database connections, and terminates workers. */
  async dispose(): Promise<void> {
    this._disposed = true;
    this.stopTick();
    this.astSeeder?.pause();
    await this._bootBackground.catch(() => {});
    await this.mapper.dispose();
    await this.store.close();
    if (this._lifecycleCtx) await this._lifecycleCtx.close();
    if (this.workers) await this.workers.dispose();
  }
}

export default Runtime;
