import nlp from "compromise";
import { DOPAT_CONFIG } from "@config";
import { metrics } from "@core_s/Metrics";
import type Resolver from "@core_i/Resolver";
import { OperatorClass, SystemRef } from "@core_i/System";
import type Store from "@core_s/Memory";
import type SemanticAtomizer from "@atomics/SemanticAtomizer"; // kept for resolveScope, which is on Atomic.Engine
import logger from "@utils/SpectralLogger";
import type Unfolder from "@core_s/Unfolder";
import { shiftPerspective, isIdentityQueryAboutSelf } from "@core_s/Identity";

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

const CODE_INTENT_PATTERNS = [
  /\b(write|generate|create|implement|show me how to|how (?:do|would) (?:i|you))\b/i,
  /\b(function|method|class|code|snippet|example)\b/i,
];

export function isCodeIntent(query: string): boolean {
  return CODE_INTENT_PATTERNS.every(p => p.test(query));
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

  /** Signature of the last resolved question — read by LiveInference for feedback. */
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

  public async processQuestion(query: string): Promise<string> {
    const sanitizedQuery = query.replace(/\?$/, "").trim();

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
      const synthesisPath =
        await this.resolver.resolveSequence(syntheticQuanta);
      const synthesisResult = this.atomizer
        .decodeSequence(synthesisPath, this.system)
        .trim();
      if (synthesisResult && synthesisResult !== "unknown") {
        metrics.increment("resolution.code_synthesis.hit");
        this.respond(`[Code Synthesis]: ${synthesisResult}`);
        return synthesisResult;
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

    // Phase 0: Vault cache lookup — moved here from Resolver so the Resolver is
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
          return response;
        }
      }
    }

    const derivationPath = await this.resolver.resolveSequence(queryQuanta);
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
      return response;
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
            return this.resolveThroughSystem(
              topologicalQuery,
              bestFact,
              isExpl
            );
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
      return fallback;
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
      return reInferredMeaning;
    }

    if (postExpandLength <= preExpandLength) {
      metrics.increment("resolution.miss");
      this.respond("unknown");
      return "unknown";
    }

    // Phase 5: Extract a coherent sentence from the raw fetched prose.
    //
    // The geodesic approach on Wikipedia-expanded content produces word salad:
    // unstructured text ingested as individual token-precepts doesn't form the
    // operator→operand inferential topology the Resolver needs, so any path
    // through those precepts is semantically arbitrary. Instead, use the prose
    // that the Unfolder already fetched — ingestion built long-term manifold
    // topology, now return the most query-relevant sentence as the immediate answer.
    const rawContent = this.unfolder.lastFetchedContent;
    if (rawContent) {
      // Split on sentence boundaries, score each sentence by keyword overlap.
      const sentences = rawContent
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 15);

      let best = "";
      let bestScore = -1;
      for (const s of sentences) {
        const lower = s.toLowerCase();
        let score = 0;
        for (const kw of heatNodes) {
          if (lower.includes(kw)) score++;
        }
        // Prefer longer sentences at equal score (more informative).
        if (
          score > bestScore ||
          (score === bestScore && s.length > best.length)
        ) {
          bestScore = score;
          best = s;
        }
      }
      if (!best && sentences.length > 0) best = sentences[0];

      if (best) {
        metrics.increment("resolution.phase5.hit");
        this.respond(best);
        return best;
      }
    }

    metrics.increment("resolution.miss");
    this.respond("unknown");
    return "unknown";
  }

  private async resolveThroughSystem(
    query: string,
    fact: string,
    isExplanatoryQuery: boolean = false
  ): Promise<string> {
    const contextQuanta = this.atomizer.ingestSequence(fact, this.system);

    const queryQuanta = this.atomizer.ingestSequence(query, this.system);
    const derivationPath = await this.resolver.resolveSequence(queryQuanta);
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
          return answerString;
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
      return fact;
    }

    this.respond(inferredMeaning);
    return inferredMeaning;
  }

  private respond(response: string): void {
    this._respond(response);
  }
}

export default Listener;
