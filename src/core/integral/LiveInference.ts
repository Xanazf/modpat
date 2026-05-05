import nlp from "compromise";

import type Resolver from "@core_i/Resolver";
import type System from "@core_i/System";
import { OperatorClass } from "@core_i/System";
import type Store from "@core_s/Memory";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import logger from "@utils/SpectralLogger";
import Unfolder from "@core_s/Unfolder";

/**
 * The LiveInference toolkit facilitates real-time topological query resolution.
 * It bridges natural language input with the logical manifold by routing intents
 * through active memory, persistent DuckDB storage.
 */
export class LiveInference {
  /** The core logical manifold where physical states are managed. */
  private system: System;
  /** Responsible for breaking down text into atomic logical quanta. */
  private atomizer: SemanticAtomizer;
  /** Executes the logical resolution and pathfinding algorithms. */
  private resolver: Resolver;
  /** Manages persistent storage and memory crystallization. */
  private store: Store;
  /** The unfolder for expanding logical voids. */
  private unfolder: Unfolder;
  /** Tracks the signature of the last processed intent for feedback reinforcement. */
  private last_signature: string | null = null;
  /** Counter for periodic maintenance tasks (e.g., wave form culling). */
  private intentCount: number = 0;

  /**
   * Initializes the inference engine with its required structural dependencies.
   *
   * @param system The logical manifold.
   * @param atomizer The semantic-to-quantum transformer.
   * @param resolver The geodesic pathfinding engine.
   * @param store The persistent memory controller.
   */
  constructor(
    system: System,
    atomizer: SemanticAtomizer,
    resolver: Resolver,
    store: Store,
    unfolder?: Unfolder
  ) {
    this.system = system;
    this.atomizer = atomizer;
    this.resolver = resolver;
    this.store = store;
    this.unfolder = unfolder || new Unfolder(system, atomizer);
    this.resolver.setUnfolder(this.unfolder);
  }

  /**
   * Processes an incoming query and routes it based on inferred intent.
   * Determines whether the input is an interrogation (Question) or an ingestion (Command).
   *
   * @param query The natural language string to process.
   * @returns A string response representing the logical result.
   */
  public async processIntent(query: string): Promise<string> {
    if (++this.intentCount % 50 === 0) {
      await this.store.cullWeakWaveForms();
    }
    const doc = nlp(query);
    // Identify questions by grammar or punctuation.
    const isQuestion = doc.questions().length > 0 || query.trim().endsWith("?");

    // Reinforcement against user feedback
    // TODO: distrust user feedback and check with Unfolder
    // stop checking after user gives X ingested corrections
    if (/^(no|incorrect|wrong|that'?s wrong|false)\b/i.test(query)) {
      if (this.last_signature) {
        await this.store.adjustEnergy(this.last_signature, -0.5);
        const response =
          "Feedback acknowledged. Structural confidence reduced.";
        this.respond(response);
        return response;
      }
    }
    if (/^(yes|correct|right|true)\b/i.test(query)) {
      if (this.last_signature) {
        await this.store.adjustEnergy(this.last_signature, 0.1);
        const response =
          "Feedback acknowledged. Structural confidence increased.";
        this.respond(response);
        return response;
      }
    }

    if (
      isQuestion ||
      query.match(/^(what|who|where|how|why|is|are|can|do|does)\b/i)
    ) {
      return this.processQuestion(query);
    } else {
      return this.processCommand(query);
    }
  }

  /**
   * Resolves a question against the logic system.
   * If the active manifold fails to resonate, it attempts to fetch data from
   * the persistent vault or Wikipedia to populate the topology.
   *
   * @param query The question string.
   * @returns The resolved answer or a fallback explanation.
   */
  public async processQuestion(query: string): Promise<string> {
    const sanitizedQuery = query.replace(/\?$/, "").trim();

    let topologicalQuery = sanitizedQuery;
    const whatIsMatch = sanitizedQuery.match(/what is (.*)/i);
    const whatWasMatch = sanitizedQuery.match(/what was (.*)/i);
    const whoIsMatch = sanitizedQuery.match(/who is (.*)/i);
    const whoWasMatch = sanitizedQuery.match(/who was (.*)/i);

    // The Attraction Center is the primary mass around which the logic orbits.
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
      // Phase 1: Dynamic Subject Extraction
      // Identify action verbs and their subsequent phrases (objects)
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

      // Fallback to noun phrase extraction if no clear action -> object mapping
      if (!attractionCenter) {
        const nounPhrases = doc.nouns().out("array");
        if (nounPhrases.length > 0) {
          attractionCenter = nounPhrases[nounPhrases.length - 1];
        }
      }
    }

    // Identify Heat Nodes (keywords) to find resonance in the topology.
    const queryDoc = nlp(query);
    const verbs = queryDoc.verbs().toInfinitive().out("array");
    const nouns = queryDoc.nouns().out("array");
    const heatNodes = [...verbs, ...nouns]
      .flatMap(w => w.toLowerCase().split(/[^a-z0-9]+/))
      .map(w => w.trim())
      .filter(w => w.length > 2);

    // Phase 1: Try the logic matrix in active memory (Direct Inference).
    const queryQuanta = this.atomizer.ingestSequence(
      topologicalQuery,
      this.system
    );
    // Track for feedback reinforcement — lets the user correct a bad question answer
    const { signature: questionSignature } =
      this.store.abstractSequence(queryQuanta);
    this.last_signature = questionSignature;
    const derivationPath = await this.resolver.resolveSequence(queryQuanta);
    const inferredMeaning = this.atomizer
      .decodeSequence(derivationPath, this.system)
      .replace(/\s+/g, " ")
      .trim();

    logger.debug(`[DEBUG] query: ${query}, topQuery: ${topologicalQuery}`);
    logger.debug(`[DEBUG] inferredMeaning: ${inferredMeaning}`);

    // WARN: Explanatory queries (who/what/how/why) should avoid simple direct identity matches
    // from the memory vault if they are too brief (single tokens), as they likely represent
    // collapsed wave-forms that lost their descriptive context.
    const isExplanatory = query.toLowerCase().match(/^(how|why|who|what)/);
    const isTooBrief = inferredMeaning.split(" ").length <= 1;

    const normalizedTopQuery = topologicalQuery
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const normalizedInferred = inferredMeaning.replace(/[^a-z0-9]/g, "");

    // found a direct resonance that isn't just the query itself.
    if (
      inferredMeaning &&
      normalizedInferred !== normalizedTopQuery &&
      inferredMeaning !== "unknown" &&
      (!isExplanatory || !isTooBrief)
    ) {
      this.respond(inferredMeaning);
      return inferredMeaning;
    }

    // Phase 2: If active memory fails, try the persistent DuckDB vault.
    if (attractionCenter) {
      try {
        await this.store.connection.run(
          `CREATE TABLE IF NOT EXISTS raw_facts (fact VARCHAR);`
        );

        // Search for facts containing the Attraction Center.
        const stmt = await this.store.connection.prepare(
          `SELECT fact FROM raw_facts WHERE fact LIKE ?`
        );
        stmt.bindVarchar(1, `%${attractionCenter}%`);
        const res = await stmt.runAndReadAll();
        const rows = res.getRows();

        if (rows && rows.length > 0) {
          let bestFact = "";
          let maxResonance = 0;
          // Rank facts by keyword overlap (Heat Node resonance).
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

          // For complex queries (how/why), verify if we have high explanatory density.
          const isComplexQuery = query.toLowerCase().match(/^(how|why)/);
          const hasExplanatoryDensity = bestFact
            .toLowerCase()
            .match(/(because|due to|from|result of|cancer|died at|death of)/);

          if (bestFact && (!isComplexQuery || hasExplanatoryDensity)) {
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

    // Phase 3: Intentional Unfolder Triggering
    if (!attractionCenter) {
      const fallback = "unknown";
      this.respond(fallback);
      return fallback;
    }

    this.respond(
      `[Unfolder] Expanding logical void for: ${attractionCenter}...`
    );

    // Create a Void Precept with negative mass to attract new knowledge
    const voidScope = this.atomizer.getSymbolScope("void");
    const voidId = this.system.createLocation(-this.system.c, voidScope);

    // Position it at the center of the query's spatial signature
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

    // Expand the void by fetching external data
    const preExpandLength = this.system.length;
    let expanded = await this.unfolder.expand(voidId, attractionCenter);
    if (!expanded && attractionCenter) {
      // Decompose query into cleaner keywords for factual expansion
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

    // Phase 4: Recursive Re-Resolution
    // The Unfolder has now populated the manifold with new encyclopedic knowledge.
    // Re-trigger the resolver to collapse the wave-form onto the correct answer.
    const reDerivationPath = await this.resolver.resolveSequence(queryQuanta);
    const reInferredMeaning = this.atomizer
      .decodeSequence(reDerivationPath, this.system)
      .replace(/\s+/g, " ")
      .trim();

    const normalizedReInferred = reInferredMeaning.replace(/[^a-z0-9]/g, "");

    if (
      reInferredMeaning &&
      normalizedReInferred !== normalizedTopQuery &&
      reInferredMeaning !== "unknown"
    ) {
      this.respond(reInferredMeaning);
      return reInferredMeaning;
    }

    // Phase 5: Action-Oriented Geodesic Routing
    // If re-resolution fails, find the highest mass Action token and map a geodesic to the target.
    // We strictly limit the search to newly ingested knowledge (i >= preExpandLength)
    // to avoid hallucinating connections from unrelated previous tasks in shared memory.
    if (postExpandLength <= preExpandLength) {
      const fallback = "unknown";
      this.respond(fallback);
      return fallback;
    }

    // Use the last node of the last Wikipedia article as the target.
    // This maximises the posY sweep: the path travels from posY≈basePosY (start of
    // article 1) all the way to posY≈basePosY+N*0.1 (end of article 3), picking up
    // vocabulary from every layer. The boost on topic keywords ("titanium", "iridium",
    // "alloy") will pull the path through the relevant content along the way.
    // We fall back to the query-derived target only if no Wikipedia content was ingested.
    const targetQuantum =
      postExpandLength > preExpandLength
        ? postExpandLength - 1
        : queryQuanta[
            Math.max(
              0,
              (() => {
                let idx = queryQuanta.length - 1;
                while (
                  idx >= 0 &&
                  this.system.operatorClass[queryQuanta[idx]] !==
                    OperatorClass.None
                )
                  idx--;
                return Math.max(0, idx);
              })()
            )
          ];

    const isHowQuery = query.toLowerCase().includes("how");
    if (isHowQuery && queryQuanta.length > 0) {
      const bestActionId = preExpandLength;

      if (bestActionId !== -1) {
        const boostScopes = new Set<number>();
        const keywordTokens = new Set<string>();
        for (const kw of heatNodes) {
          for (const tok of kw.toLowerCase().split(/\s+/)) {
            if (tok.length > 2) keywordTokens.add(tok);
          }
        }
        for (let i = preExpandLength; i < postExpandLength; i++) {
          const sym = this.atomizer.resolveScope(this.system.scope[i]);
          if (sym && keywordTokens.has(sym))
            boostScopes.add(this.system.scope[i]);
        }

        logger.debug(`[DEBUG Phase5] heatNodes: ${JSON.stringify(heatNodes)}`);
        logger.debug(
          `[DEBUG Phase5] keywordTokens: ${JSON.stringify([...keywordTokens])}`
        );
        logger.debug(`[DEBUG Phase5] boostScopes size: ${boostScopes.size}`);
        logger.debug(
          `[DEBUG Phase5] bestActionId: ${bestActionId} => "${this.atomizer.resolveScope(this.system.scope[bestActionId])}", posZ=${this.system.posZ[bestActionId].toFixed(2)}`
        );
        logger.debug(
          `[DEBUG Phase5] targetQuantum: ${targetQuantum} => "${this.atomizer.resolveScope(this.system.scope[targetQuantum])}", posZ=${this.system.posZ[targetQuantum].toFixed(2)}`
        );
        logger.debug(
          `[DEBUG Phase5] preExpandLength: ${preExpandLength}, postExpandLength: ${postExpandLength}`
        );

        // Intra-Layer Routing:
        // Find the first AND last node of each posZ layer, then route a geodesic
        // entirely within each layer from its start to its end. This ensures each
        // Wikipedia article is read in full from its opening sentence to its last
        // word, rather than being cut short mid-article during a cross-layer jump.
        const layerBounds = new Map<number, { first: number; last: number }>();
        for (let i = preExpandLength; i < postExpandLength; i++) {
          const lk = Math.floor(this.system.posZ[i] / 10.0);
          const b = layerBounds.get(lk);
          if (!b) layerBounds.set(lk, { first: i, last: i });
          else b.last = i;
        }
        const sortedLayers = [...layerBounds.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, bounds]) => bounds);
        logger.debug(`[DEBUG Phase5] layers: ${JSON.stringify(sortedLayers)}`);

        const combinedIds: number[] = [];
        for (let seg = 0; seg < sortedLayers.length; seg++) {
          const { first, last } = sortedLayers[seg];
          const segPath = await this.resolver.calculateGeodesic(
            first,
            last,
            128,
            // No boostScopes within a layer: the path only needs to travel linearly
            // from first to last within its own posZ layer. Passing boostScopes
            // here causes the path to jump between every keyword occurrence inside
            // the article, scrambling the grammar (e.g. 10x "iridium" attractors
            // in the Iridium article). Boosts are only meaningful across layers.
            undefined,
            undefined,
            preExpandLength
          );
          const skipFirst = seg > 0;
          for (let k = skipFirst ? 1 : 0; k < segPath.length; k++) {
            const id = segPath[k];
            if (
              combinedIds.length === 0 ||
              combinedIds[combinedIds.length - 1] !== id
            ) {
              combinedIds.push(id);
            }
          }
        }

        if (combinedIds.length > 0) {
          const answerString = this.atomizer
            .decodeSequence(new Uint32Array(combinedIds), this.system)
            .replace(/\s+/g, " ")
            .trim();

          if (answerString && answerString !== "unknown") {
            this.respond(`[Geodesic Generative]: ${answerString}`);
            return answerString;
          }
        }
      }
    }

    const fallback = "unknown";
    this.respond(fallback);
    return fallback;
  }

  /**
   * Pushes a found fact into the system buffer and resolves the original query
   * against it using Geodesic Pathfinding.
   *
   * @param query The target query string.
   * @param fact The contextual fact to use as the topology.
   * @param isExplanatoryQuery Whether the original query was an explanatory question.
   * @returns The most likely answer string derived from the fact.
   */
  private async resolveThroughSystem(
    query: string,
    fact: string,
    isExplanatoryQuery: boolean = false
  ): Promise<string> {
    // 1. Ingest the factual context into the system to create the manifold.
    const contextQuanta = this.atomizer.ingestSequence(fact, this.system);

    // 2. Attempt direct resolution of the query quanta.
    const queryQuanta = this.atomizer.ingestSequence(query, this.system);
    const derivationPath = await this.resolver.resolveSequence(queryQuanta);
    const inferredMeaning = this.atomizer
      .decodeSequence(derivationPath, this.system)
      .replace(/\s+/g, " ")
      .trim();

    // 3. Fallback: Geodesic Pathfinding.
    // If direct inference fails, we find the shortest path between the fact and the query targets.
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
      // Find the last non-operator token to use as the target
      let targetIdx = queryQuanta.length - 1;
      while (
        targetIdx >= 0 &&
        this.system.operatorClass[queryQuanta[targetIdx]] !== OperatorClass.None
      ) {
        targetIdx--;
      }
      const targetQuantum = queryQuanta[Math.max(0, targetIdx)];

      // Phase 4 (Action-Oriented Geodesic Routing)
      let sourceQuantum = contextQuanta[0];

      const doc = nlp(query);
      const isHowQuery = doc.has("how");
      if (isHowQuery) {
        let bestActionId = -1;
        let maxMass = -Infinity;

        // Find high mass action in the *context*
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

      // LOGIC: Boost keyword scopes to pull the geodesic path towards relevant concepts.
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

      // Calculate the geodesic path through the manifold.
      const geodesicPath = await this.resolver.calculateGeodesic(
        sourceQuantum,
        targetQuantum,
        128,
        boostScopes
      );

      // LOGIC: Use the geodesic hits to identify a coherent window of resonance within the fact.
      const factIdSet = new Set(contextQuanta);
      const contextResonance = Array.from(geodesicPath).filter(id =>
        factIdSet.has(id)
      );

      if (contextResonance.length > 0) {
        let minFactIdx = contextQuanta.length;
        let maxFactIdx = -1;

        // Map geodesic hits back to their original sequence indices.
        for (const hit of contextResonance) {
          const idx = Array.from(contextQuanta).indexOf(hit);
          if (idx !== -1) {
            minFactIdx = Math.min(minFactIdx, idx);
            maxFactIdx = Math.max(maxFactIdx, idx);
          }
        }

        // Expand the window for explanatory queries to capture more context.
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

    // 4. Entropy logging (Surprisal check).
    // High surprisal indicates the logic path was highly improbable or unstable.
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

    // If all else fails, return the raw fact if available.
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

  /**
   * Ingests a factual statement or command into the system buffer and vault.
   * This process "crystallizes" raw information into a stable interference pattern.
   *
   * @param statement The declarative string to commit.
   * @returns The decoded meaning as understood by the system.
   */
  public async processCommand(statement: string): Promise<string> {
    const doc = nlp(statement);

    // Phase 3: Pre-Ingestion Resonance Check (Contradiction Detection)
    let invertedStatement = "";
    if (doc.has("#Negative")) {
      invertedStatement = doc.sentences().toPositive().text();
    } else {
      invertedStatement = doc.sentences().toNegative().text();
    }

    if (invertedStatement && invertedStatement !== statement) {
      const invertedQuanta = this.atomizer.ingestSequence(
        invertedStatement,
        this.system
      );
      const collisionPath =
        await this.store.checkInterferencePattern(invertedQuanta);

      if (collisionPath && collisionPath.length > 0) {
        const { signature } = this.store.abstractSequence(invertedQuanta);
        // Penalize the cached fact (it's potentially false if new data says otherwise)
        await this.store.adjustEnergy(signature, -0.5);

        // Free the invertedQuanta in reverse order so the freeList pops them sequentially
        for (let i = invertedQuanta.length - 1; i >= 0; i--) {
          this.system.freeLocation(invertedQuanta[i], "contradiction_check");
        }

        const response = `[Logic Trap Detected]: Input contradicts known topological signature. Cached confidence penalized.`;
        this.respond(response);
        return response;
      }

      // Cleanup the check quanta if no collision, in reverse order
      for (let i = invertedQuanta.length - 1; i >= 0; i--) {
        this.system.freeLocation(
          invertedQuanta[i],
          "contradiction_check_clean"
        );
      }
    }

    const quanta = this.atomizer.ingestSequence(statement, this.system);

    if (quanta.length > 0) {
      const { signature } = this.store.abstractSequence(quanta);
      this.last_signature = signature;

      // 1. Cache the interference pattern in active memory.
      await this.store.crystallizeProof(quanta, quanta, 1.0);

      // 2. Store the raw fact in the persistent vault (DuckDB).
      try {
        await this.store.connection.run(
          `CREATE TABLE IF NOT EXISTS raw_facts (fact VARCHAR);`
        );
        const stmt = await this.store.connection.prepare(
          `INSERT INTO raw_facts (fact) VALUES (?)`
        );
        stmt.bindVarchar(1, statement);
        await stmt.run();
        stmt.destroySync();
      } catch (e) {
        logger.error("Vault Insert Error:", e);
      }

      // Decode the system quanta to ensure what we log is exactly what the manifold captured.
      const decodedMeaning = this.atomizer.decodeSequence(quanta, this.system);

      logger.wave("Ingest", this.system, quanta, this.atomizer);

      const response = `Acknowledged: "${decodedMeaning}"`;
      this.respond(response);
      return decodedMeaning;
    } else {
      const response = `Ignored (Unprocessable Input): "${statement}"`;
      this.respond(response);
      return response;
    }
  }

  /**
   * Dispatches the final output to the user and logs.
   *
   * @param response The resultant string output.
   */
  public respond(response: string): void {
    logger.log(`[LiveInference]: ${response}`);
  }
}

export default LiveInference;
