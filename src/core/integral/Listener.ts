import type SemanticAtomizer from "@atomics/SemanticAtomizer"; // kept for resolveScope, which is on Atomic.Engine
import { DOPAT_CONFIG } from "@config";
import type Resolver from "@core_i/Resolver";
import type { ResolverDiagnostics } from "@core_i/Resolver";
import { OperatorClass, type SystemRef } from "@core_i/System";
import { isIdentityQueryAboutSelf, shiftPerspective } from "@core_s/Identity";
import type Store from "@core_s/Memory";
import { metrics } from "@core_s/Metrics";
import type Unfolder from "@core_s/Unfolder";
import logger from "@utils/SpectralLogger";
import nlp from "compromise";

/** Per-call inputs to Listener.processQuestion. */
export interface ListenerOptions {
  /** Forwarded to Resolver as opts.contextScopes - working-memory warm start. */
  contextScopes?: Set<number>;
}

/** Output of Listener.processQuestion — text plus the diagnostics that produced it. */
export interface ListenerResult {
  /** Human-readable answer text. */
  text: string;
  /**
   * Diagnostics captured under the same slot lock as the answer. Race-free
   * across concurrent producers — prefer over Resolver.lastDiagnostics.
   */
  diagnostics: ResolverDiagnostics | null;
}

const BIGRAM_VOCABULARY = new Set([
  "machine_learning",
  "neural_network",
  "binary_tree",
  "hash_map",
  "linked_list",
  "decision_tree",
  "random_forest",
  "natural_language",
  "deep_learning",
  "reinforcement_learning",
  "gradient_descent",
  "back_propagation",
  "transfer_learning",
  "convolutional_network",
  "recurrent_network",
  "attention_mechanism",
  "transformer_model",
  "knowledge_graph",
  "vector_database",
  "language_model",
]);

const CODE_ACTION_PATTERN =
  /\b(write|generate|create|implement|show me how to|how (?:do|would) (?:i|you))\b/i;
const CODE_NOUN_PATTERN =
  /\b(function|method|class|code|snippet|example|algorithm|sort|fibonacci|factorial|binary|search|tree|graph|linked.?list|queue|stack|hash.?map)\b/i;
const WH_QUESTION_PATTERN =
  /^(what|who|where|when|why|how\s+is|how\s+are|how\s+does)\b/i;

// I7 fix: accept queries with a code action verb (regardless of noun), or a code noun
// when the query is NOT a WH-question and NOT a physics sink query (contains "|-").
// Original `every()` required both verb AND noun - too strict for "write a fibonacci".
export function isCodeIntent(query: string): boolean {
  // Physics sink queries ("X |-") are always routed through the Resolver, not code synthesis.
  if (query.includes("|-")) return false;
  if (CODE_ACTION_PATTERN.test(query)) return true;
  return (
    CODE_NOUN_PATTERN.test(query) && !WH_QUESTION_PATTERN.test(query.trim())
  );
}

/**
 * Handles question processing: resolves queries against the active manifold,
 * falls through to the DuckDB vault, and triggers the Unfolder when needed.
 */
class Listener {
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  private atomizer: Atomic.Engine;
  private resolver: Resolver;
  private store: Store;
  private unfolder: Unfolder;
  private _respond: (msg: string) => void;

  /** Signature of the last resolved question - read by LiveInference for feedback. */
  public lastSignature: string | null = null;

  constructor(
    systemRef: SystemRef,
    atomizer: Atomic.Engine,
    resolver: Resolver,
    store: Store,
    unfolder: Unfolder,
    respond?: (msg: string) => void
  ) {
    this.systemRef = systemRef;
    this.atomizer = atomizer;
    this.resolver = resolver;
    this.store = store;
    this.unfolder = unfolder;
    this._respond = respond ?? (msg => logger.log(`[LiveInference]: ${msg}`));
  }

  public async processQuestion(
    query: string,
    opts: ListenerOptions = {}
  ): Promise<ListenerResult> {
    const sanitizedQuery = query.replace(/\?$/, "").trim();
    const ctxScopes = opts.contextScopes;
    /** Diagnostics from the most recent resolver call - returned to the caller. */
    let lastDiag: ResolverDiagnostics | null = null;
    const wrap = (text: string): ListenerResult => ({
      text,
      diagnostics: lastDiag,
    });

    // Perspective shift: rewrite second-person input to first-person before the
    // manifold sees it.  "who are you?" → "i am", "your X" → "my X", etc.
    // This ensures the self-scope (shared by all pronouns) triggers the correct
    // vault proofs and resonance paths.
    const wasIdentityQuery = isIdentityQueryAboutSelf(query);
    const shifted = shiftPerspective(sanitizedQuery);

    if (isCodeIntent(shifted)) {
      const syntheticQuery = sanitizedQuery + " |-";
      const syntheticQuanta = this.atomizer.ingestSequence(
        syntheticQuery,
        this.system
      );
      const synthCap = await this.resolver.resolveSequenceCaptured(
        syntheticQuanta,
        { contextScopes: ctxScopes }
      );
      lastDiag = synthCap.diagnostics;
      const synthesisResult = this.atomizer
        .decodeSequence(synthCap.ids, this.system)
        .trim();
      if (synthesisResult && synthesisResult !== "unknown") {
        metrics.increment("resolution.code_synthesis.hit");
        this.respond(`[Code Synthesis]: ${synthesisResult}`);
        return wrap(synthesisResult);
      }
    }

    let topologicalQuery = shifted;
    const whatIsMatch = shifted.match(/what is (.*)/i);
    const whatWasMatch = shifted.match(/what was (.*)/i);
    const whoIsMatch = shifted.match(/who is (.*)/i);
    const whoWasMatch = shifted.match(/who was (.*)/i);

    let attractionCenter = "";
    if (whatIsMatch) {
      attractionCenter = whatIsMatch[1];
      topologicalQuery = `${attractionCenter} is`;
    } else if (whatWasMatch) {
      attractionCenter = whatWasMatch[1];
      topologicalQuery = `${attractionCenter} was`;
    } else if (whoIsMatch) {
      attractionCenter = whoIsMatch[1];
      topologicalQuery = `${attractionCenter} is`;
    } else if (whoWasMatch) {
      attractionCenter = whoWasMatch[1];
      topologicalQuery = `${attractionCenter} was`;
    } else {
      const doc = nlp(query);
      const actionVerbs = doc.verbs().out("array");
      if (actionVerbs.length > 0) {
        const primaryVerb = actionVerbs[0];
        const directObject = doc.match(`${primaryVerb} [*]`).out("text").trim();
        if (directObject) {
          attractionCenter = directObject
            .replace(primaryVerb, "")
            .replace(/\?$/, "")
            .trim();
        }
      }
      if (!attractionCenter) {
        const nounPhrases = doc.nouns().out("array");
        if (nounPhrases.length > 0) {
          attractionCenter = nounPhrases[nounPhrases.length - 1];
        }
      }
    }

    const queryDoc = nlp(query);
    const verbs = queryDoc.verbs().toInfinitive().out("array");
    const nouns = queryDoc.nouns().out("array");
    const rawWords = [...verbs, ...nouns]
      .flatMap(w => w.toLowerCase().split(/[^a-z0-9]+/))
      .map(w => w.trim())
      .filter(w => w.length > 2);

    const heatNodes: string[] = [];
    let wi = 0;
    while (wi < rawWords.length) {
      if (wi + 1 < rawWords.length) {
        const bigram = `${rawWords[wi]}_${rawWords[wi + 1]}`;
        if (BIGRAM_VOCABULARY.has(bigram)) {
          heatNodes.push(bigram);
          wi += 2;
          continue;
        }
      }
      heatNodes.push(rawWords[wi]);
      wi++;
    }

    const queryQuanta = this.atomizer.ingestSequence(
      topologicalQuery,
      this.system
    );
    const { signature: questionSignature } =
      this.store.abstractSequence(queryQuanta);
    this.lastSignature = questionSignature;

    // Phase 0: Vault cache lookup - moved here from Resolver so the Resolver is
    // a pure physics engine.  Uses queryQuanta (the topological query WITHOUT the
    // Sink "|-") because crystallization also uses that same sequence as the key.
    {
      const cached = await this.store.checkInterferencePattern(queryQuanta);
      if (cached && cached.ids.length > 0) {
        const decoded = this.atomizer
          .decodeSequence(cached.ids, this.system)
          .trim();
        if (decoded && decoded !== "unknown") {
          metrics.increment("resolution.phase0.hit");
          this.resolver.reinforceVaultHit(queryQuanta, cached.ids);
          const response =
            wasIdentityQuery && topologicalQuery.trim() === "i am"
              ? `i am ${decoded}`
              : decoded;
          this.respond(response);
          return wrap(response);
        }
      }
    }

    const phase1Cap = await this.resolver.resolveSequenceCaptured(queryQuanta, {
      contextScopes: ctxScopes,
    });
    lastDiag = phase1Cap.diagnostics;
    const derivationPath = phase1Cap.ids;
    const inferredMeaning = this.atomizer
      .decodeSequence(derivationPath, this.system)
      .replace(/\s+/g, " ")
      .trim();

    logger.debug(`[DEBUG] query: ${query}, topQuery: ${topologicalQuery}`);
    logger.debug(`[DEBUG] inferredMeaning: ${inferredMeaning}`);

    const isExplanatory = query.toLowerCase().match(/^(how|why|who|what)/);
    const isTooBrief = inferredMeaning.split(" ").length <= 1;

    const normalizedTopQuery = topologicalQuery
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const normalizedInferred = inferredMeaning.replace(/[^a-z0-9]/g, "");

    if (
      inferredMeaning &&
      normalizedInferred !== normalizedTopQuery &&
      inferredMeaning !== "unknown" &&
      (!isExplanatory || !isTooBrief)
    ) {
      metrics.increment("resolution.phase1.hit");

      // For identity questions about self ("who are you?", "what are you?"),
      // reconstruct the full first-person sentence so the response sounds like
      // the system speaking about itself rather than just emitting a bare object.
      const response =
        wasIdentityQuery && topologicalQuery.trim().toLowerCase() === "i am"
          ? `i am ${inferredMeaning}`
          : inferredMeaning;

      this.respond(response);
      return wrap(response);
    }

    if (attractionCenter) {
      try {
        const stmt = await this.store.connection.prepare(
          `SELECT fact FROM raw_facts WHERE fact LIKE ? ORDER BY confidence DESC LIMIT 100`
        );
        stmt.bindVarchar(1, `%${attractionCenter}%`);
        const res = await stmt.runAndReadAll();
        const rows = res.getRows();

        if (rows && rows.length > 0) {
          let bestFact = "";
          let maxResonance = 0;
          for (const row of rows) {
            const fact = row[0]?.toString() || "";
            const fLower = fact.toLowerCase();
            let matches = 0;
            for (const kw of heatNodes) {
              if (fLower.includes(kw)) matches++;
            }
            if (matches > maxResonance) {
              maxResonance = matches;
              bestFact = fact;
            }
          }

          if (!bestFact) bestFact = rows[0][0]?.toString() || "";

          const isComplexQuery = query.toLowerCase().match(/^(how|why)/);
          const hasExplanatoryDensity = bestFact
            .toLowerCase()
            .match(/(because|due to|from|result of|cancer|died at|death of)/);

          if (bestFact && (!isComplexQuery || hasExplanatoryDensity)) {
            metrics.increment("resolution.phase2.hit");
            const isExpl = Boolean(
              query.toLowerCase().match(/^(how|why|who|what)/)
            );
            const phase2 = await this.resolveThroughSystem(
              topologicalQuery,
              bestFact,
              isExpl,
              ctxScopes
            );
            // Stitch the phase-2 diagnostics into our local capture chain so
            // the caller sees the same race-free view of the final pass.
            lastDiag = phase2.diagnostics ?? lastDiag;
            return wrap(phase2.text);
          }
        }
      } catch (e) {
        logger.error("Vault Search Error:", e);
      }
    }

    if (!attractionCenter) {
      metrics.increment("resolution.miss");
      const fallback = "unknown";
      this.respond(fallback);
      return wrap(fallback);
    }

    logger.debug(`[Unfolder] Expanding logical void for: ${attractionCenter}`);

    const voidScope = this.atomizer.getSymbolScope("void", false);
    const voidId = this.system.createLocation(-this.system.c, voidScope);

    let avgX = 0,
      avgY = 0;
    for (let i = 0; i < queryQuanta.length; i++) {
      avgX += this.system.posX[queryQuanta[i]];
      avgY += this.system.posY[queryQuanta[i]];
    }
    if (queryQuanta.length > 0) {
      this.system.posX[voidId] = avgX / queryQuanta.length;
      this.system.posY[voidId] = avgY / queryQuanta.length;
    }
    this.system.update(voidId);

    const preExpandLength = this.system.length;
    let expanded = await this.unfolder.expand(voidId, attractionCenter);
    if (!expanded && attractionCenter) {
      const terms = nlp(attractionCenter).terms().out("array");
      for (let term of terms) {
        term = term.replace(/[^a-zA-Z0-9]/g, "");
        if (term.length > 2) {
          const tExpanded = await this.unfolder.expand(voidId, term);
          if (tExpanded) expanded = true;
        }
      }
    }
    const postExpandLength = this.system.length;

    // Phase 4: re-resolve with the richer manifold using the coherence loop.
    // resolveCoherent is strictly more powerful than resolveSequence: it iterates,
    // scores amplitude × contrast, and diagnoses void/conflict/weak explicitly.
    const coherentResult = await this.resolver.resolveCoherent(queryQuanta, {
      maxIterations: 3,
    });
    lastDiag = coherentResult.diagnostics ?? lastDiag;
    const reInferredMeaning = this.atomizer
      .decodeSequence(coherentResult.ids, this.system)
      .replace(/\s+/g, " ")
      .trim();
    const normalizedReInferred = reInferredMeaning.replace(/[^a-z0-9]/g, "");

    if (
      reInferredMeaning &&
      normalizedReInferred !== normalizedTopQuery &&
      reInferredMeaning !== "unknown" &&
      (coherentResult.diagnosis === "coherent" ||
        coherentResult.diagnosis === "weak")
    ) {
      metrics.increment("resolution.phase4.hit");
      this.respond(reInferredMeaning);
      return wrap(reInferredMeaning);
    }

    if (postExpandLength <= preExpandLength) {
      metrics.increment("resolution.miss");
      this.respond("unknown");
      return wrap("unknown");
    }

    // Phase 5: Geodesic plan through sentence-layered expanded content.
    //
    // ingestContent() places each sentence at a distinct posZ layer
    // (sentence 0 → factZ+0, sentence 1 → factZ+1, ...).  The Mapper's
    // geodesic therefore traverses sentences in causal/logical order.
    // Decoding the path layer-by-layer produces a coherent step-by-step
    // answer - the plan emerges directly from the physics.
    //
    // G2 fix: before falling back to the full geodesic plan, try to find
    // an SVO triple in the expanded atoms whose subject matches the query
    // topic.  If one is found, return its predicate+object as a direct
    // inference answer - this is reasoning from structure, not retrieval.
    if (postExpandLength > preExpandLength) {
      if (attractionCenter) {
        const tripleAnswer = this._findDirectTripleAnswer(
          attractionCenter,
          preExpandLength,
          postExpandLength
        );
        if (tripleAnswer) {
          metrics.increment("resolution.phase5.triple_hit");
          this.respond(tripleAnswer);
          return wrap(tripleAnswer);
        }
      }

      let entryId = preExpandLength;
      let exitId = postExpandLength - 1;
      let bestMatchScore = -1;
      let bestDensity = -Infinity;

      for (let i = preExpandLength; i < postExpandLength; i++) {
        if (!this.system.isAllocated(i)) continue;
        const sym = this.atomizer.resolveScope(this.system.scope[i]) ?? "";
        let matchScore = 0;
        for (const kw of heatNodes) {
          if (sym === kw || sym.startsWith(kw) || kw.startsWith(sym))
            matchScore++;
        }
        if (matchScore > bestMatchScore) {
          bestMatchScore = matchScore;
          entryId = i;
        }
        const density = this.system.mass[i] * (1 + this.system.depth[i]);
        if (density > bestDensity) {
          bestDensity = density;
          exitId = i;
        }
      }

      if (entryId !== exitId) {
        const boostScopes = new Set<number>();
        for (const kw of heatNodes) {
          const scope = this.atomizer.getSymbolScope(kw, false);
          if (scope > 0) boostScopes.add(scope);
        }

        const geodesicPath = await this.resolver.calculateGeodesic(
          entryId,
          exitId,
          128,
          boostScopes.size > 0 ? boostScopes : undefined,
          undefined,
          preExpandLength
        );

        const plan = this.buildPlanFromGeodesic(geodesicPath, preExpandLength);
        if (plan) {
          metrics.increment("resolution.phase5.hit");
          this.respond(plan);
          return wrap(plan);
        }
      }
    }

    metrics.increment("resolution.miss");
    this.respond("unknown");
    return wrap("unknown");
  }

  /**
   * G2 fix: scans the expanded manifold atoms for an SVO triple whose subject
   * matches the query's attraction centre, and returns the predicate+object as
   * a direct inference answer.
   *
   * ingestContent() now tags each ingested sequence with an incremental posZ
   * layer index (sentence 0 → posZ+0, sentence 1 → posZ+1, …).  When
   * extractTriples() succeeded, each layer is a subject–predicate–object triple.
   * This method finds the layer whose decoded first token best matches the query
   * topic and returns the rest of that layer as the inferred answer.
   *
   * Returns null when no matching triple is found - caller falls through to
   * the geodesic plan.
   */
  private _findDirectTripleAnswer(
    attractionCenter: string,
    preExpandLength: number,
    postExpandLength: number
  ): string | null {
    const targetScope = this.atomizer.getSymbolScope(
      attractionCenter.toLowerCase().trim(),
      false
    );

    // Group expanded atoms by posZ layer (each layer = one ingested sequence).
    const layers = new Map<number, number[]>();
    for (let i = preExpandLength; i < postExpandLength; i++) {
      if (!this.system.isAllocated(i)) continue;
      const layer = Math.floor(this.system.posZ[i]);
      let group = layers.get(layer);
      if (!group) {
        group = [];
        layers.set(layer, group);
      }
      group.push(i);
    }

    let bestAnswer = "";
    let bestScore = 0;

    for (const [, atoms] of layers) {
      if (atoms.length < 2) continue;

      // Score the layer by how well its atoms' scopes overlap with the target scope.
      let subjectScore = 0;
      for (const id of atoms.slice(0, Math.min(3, atoms.length))) {
        if (this.system.scope[id] === targetScope) subjectScore += 2;
        // Partial match: scope is close (same ontology region)
        const decoded = this.atomizer.resolveScope(this.system.scope[id]) ?? "";
        if (
          decoded &&
          attractionCenter.toLowerCase().includes(decoded.toLowerCase())
        )
          subjectScore++;
      }

      if (subjectScore === 0) continue;

      // Decode the full layer; the "answer" is everything after the first token.
      const fullText = this.atomizer
        .decodeSequence(new Uint32Array(atoms), this.system)
        .replace(/\s+/g, " ")
        .trim();

      const words = fullText.split(" ");
      if (words.length < 2) continue;

      // Strip the subject token(s) to get predicate + object.
      const subjWords = attractionCenter.toLowerCase().split(/\s+/);
      const bodyStart = Math.min(subjWords.length, words.length - 1);
      const answer = words.slice(bodyStart).join(" ");

      if (
        answer.length > 2 &&
        answer !== "unknown" &&
        subjectScore > bestScore
      ) {
        bestScore = subjectScore;
        bestAnswer = answer;
      }
    }

    return bestAnswer || null;
  }

  /**
   * Decodes a geodesic path as a step-by-step plan by grouping atoms into
   * their sentence layers (posZ floor) and decoding each layer in order.
   *
   * Because ingestContent() tagged each sentence's atoms with an incremental
   * posZ offset, Math.floor(posZ) uniquely identifies which sentence an atom
   * came from.  Sorting layers by ascending Z gives causal/logical order.
   *
   * Returns a newline-separated numbered list when multiple steps are found,
   * a bare string for a single step, or null when the path is uninformative.
   */
  private buildPlanFromGeodesic(
    geodesicPath: Uint32Array,
    preExpandLength: number
  ): string | null {
    const layers = new Map<number, number[]>();

    for (const id of geodesicPath) {
      if (id < preExpandLength || !this.system.isAllocated(id)) continue;
      // Use Math.floor so that atoms in the same sentence (posZ within 1 unit
      // of each other) group together regardless of depth/operator variation.
      const layer = Math.floor(this.system.posZ[id]);
      let group = layers.get(layer);
      if (!group) {
        group = [];
        layers.set(layer, group);
      }
      group.push(id);
    }

    if (layers.size === 0) return null;

    // I8 fix: deduplicate by decoded content, not just by atom.
    const seen = new Set<string>();
    const steps = [...layers.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, atoms]) =>
        this.atomizer
          .decodeSequence(new Uint32Array(atoms), this.system)
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(s => {
        if (s.length <= 3 || s === "unknown") return false;
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      });

    if (steps.length === 0) return null;
    if (steps.length === 1) return steps[0];
    return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  }

  private async resolveThroughSystem(
    query: string,
    fact: string,
    isExplanatoryQuery: boolean = false,
    contextScopes?: Set<number>
  ): Promise<ListenerResult> {
    const contextQuanta = this.atomizer.ingestSequence(fact, this.system);

    const queryQuanta = this.atomizer.ingestSequence(query, this.system);
    const cap = await this.resolver.resolveSequenceCaptured(queryQuanta, {
      contextScopes,
    });
    let lastDiag: ResolverDiagnostics | null = cap.diagnostics;
    const wrap = (text: string): ListenerResult => ({
      text,
      diagnostics: lastDiag,
    });
    const derivationPath = cap.ids;
    const inferredMeaning = this.atomizer
      .decodeSequence(derivationPath, this.system)
      .replace(/\s+/g, " ")
      .trim();

    const isExplanatory =
      isExplanatoryQuery || query.toLowerCase().match(/^(how|why|who|what)/);

    if (
      (isExplanatory ||
        !inferredMeaning ||
        inferredMeaning === query.toLowerCase() ||
        inferredMeaning === "unknown") &&
      queryQuanta.length > 0 &&
      contextQuanta.length > 0
    ) {
      let targetIdx = queryQuanta.length - 1;
      while (
        targetIdx >= 0 &&
        this.system.operatorClass[queryQuanta[targetIdx]] !== OperatorClass.None
      ) {
        targetIdx--;
      }
      const targetQuantum = queryQuanta[Math.max(0, targetIdx)];

      let sourceQuantum = contextQuanta[0];

      const doc = nlp(query);
      const isHowQuery = doc.has("how");
      if (isHowQuery) {
        let bestActionId = -1;
        let maxMass = -Infinity;
        for (let i = 0; i < contextQuanta.length; i++) {
          const id = contextQuanta[i];
          if (this.system.operatorClass[id] === OperatorClass.Action) {
            if (this.system.mass[id] > maxMass) {
              maxMass = this.system.mass[id];
              bestActionId = id;
            }
          }
        }
        if (bestActionId !== -1) {
          sourceQuantum = bestActionId;
        }
      }

      const keywords = [
        ...doc.verbs().out("array"),
        ...doc.nouns().out("array"),
      ];
      const boostScopes = new Set<number>();
      for (const kw of keywords) {
        const atomizedIds = this.atomizer.ingestSequence(kw, this.system);
        if (atomizedIds.length > 0)
          boostScopes.add(this.system.scope[atomizedIds[0]]);
      }

      const geodesicPath = await this.resolver.calculateGeodesic(
        sourceQuantum,
        targetQuantum,
        128,
        boostScopes
      );

      const factIdSet = new Set(contextQuanta);
      const contextResonance = Array.from(geodesicPath).filter(id =>
        factIdSet.has(id)
      );

      if (contextResonance.length > 0) {
        let minFactIdx = contextQuanta.length;
        let maxFactIdx = -1;

        for (const hit of contextResonance) {
          const idx = Array.from(contextQuanta).indexOf(hit);
          if (idx !== -1) {
            minFactIdx = Math.min(minFactIdx, idx);
            maxFactIdx = Math.max(maxFactIdx, idx);
          }
        }

        if (isExplanatory && maxFactIdx !== -1) {
          maxFactIdx = Math.min(contextQuanta.length - 1, maxFactIdx + 15);
        }

        const focusedQuanta = contextQuanta.slice(minFactIdx, maxFactIdx + 1);
        const answerString = this.atomizer
          .decodeSequence(focusedQuanta, this.system)
          .replace(/\s+/g, " ")
          .trim();

        if (answerString && answerString !== "unknown") {
          logger.wave(
            "Geodesic Resolve",
            this.system,
            new Uint32Array(focusedQuanta),
            this.atomizer
          );
          this.respond(`[Geodesic]: ${answerString}`);
          return wrap(answerString);
        }
      }
    }

    if (inferredMeaning && inferredMeaning !== "unknown") {
      let totalEntropy = 0;
      for (let i = 0; i < derivationPath.length; i++) {
        totalEntropy += this.system.entropyRate[derivationPath[i]];
      }
      const avgEntropy = totalEntropy / (derivationPath.length || 1);
      if (avgEntropy > 5) {
        this.respond(`[Inference Surprisal: ${avgEntropy.toFixed(2)} bits]`);
      }
    }

    if (
      !inferredMeaning ||
      inferredMeaning === query.toLowerCase() ||
      inferredMeaning === "unknown"
    ) {
      this.respond(fact);
      return wrap(fact);
    }

    this.respond(inferredMeaning);
    return wrap(inferredMeaning);
  }

  private respond(response: string): void {
    this._respond(response);
  }
}

export default Listener;
