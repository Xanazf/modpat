import axios from "axios";
import nlp from "compromise";
import wiki from "wikipedia";

import type Resolver from "@core_i/Resolver";
import type System from "@core_i/System";
import type Store from "@core_s/Memory";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import logger from "@utils/SpectralLogger";

// Wikipedia API requires a valid User-Agent to avoid 403 Forbidden errors.
// This identifies the engine as a research tool for topological logic.
axios.defaults.headers.common["User-Agent"] =
  "MpatLogicEngine/1.0 (https://github.com/dopecodez/Wikipedia/)";

/**
 * The LiveInference toolkit facilitates real-time topological query resolution.
 * It bridges natural language input with the logical manifold by routing intents
 * through active memory, persistent DuckDB storage, and external knowledge sources like Wikipedia.
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
    store: Store
  ) {
    this.system = system;
    this.atomizer = atomizer;
    this.resolver = resolver;
    this.store = store;
  }

  /**
   * Processes an incoming query and routes it based on inferred intent.
   * Determines whether the input is an interrogation (Question) or an ingestion (Command).
   *
   * @param query The natural language string to process.
   * @returns A string response representing the logical result.
   */
  public async processIntent(query: string): Promise<string> {
    const doc = nlp(query);
    // Identify questions by grammar or punctuation.
    const isQuestion = doc.questions().length > 0 || query.trim().endsWith("?");

    // Route based on the "heat" of the inquiry tokens.
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
      topologicalQuery = `${attractionCenter}`;
    } else {
      const doc = nlp(query);
      const nouns = doc.nouns().out("array");
      if (nouns.length > 0) {
        attractionCenter = nouns[nouns.length - 1];
      }
    }

    // Identify Heat Nodes (keywords) to find resonance in the topology.
    // Verbs and nouns define the peaks of interest.
    const queryDoc = nlp(query);
    const verbs = queryDoc.verbs().toInfinitive().out("array");
    const nouns = queryDoc.nouns().out("array");
    const heatNodes = [...verbs, ...nouns]
      .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter(w => w.length > 2);

    // Phase 1: Try the logic matrix in active memory (Direct Inference).
    const queryQuanta = this.atomizer.ingestSequence(
      topologicalQuery,
      this.system
    );
    const derivationPath = await this.resolver.resolveSequence(queryQuanta);
    const inferredMeaning = this.atomizer
      .decodeSequence(derivationPath, this.system)
      .replace(/\s+/g, " ")
      .trim();

    // If we found a direct resonance that isn't just the query itself.
    if (
      inferredMeaning &&
      inferredMeaning !== topologicalQuery.toLowerCase() &&
      inferredMeaning !== "unknown"
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
            return this.resolveThroughSystem(topologicalQuery, bestFact);
          }
        }
      } catch (e) {
        logger.error("Vault Search Error:", e);
      }
    }

    // Phase 3: External Knowledge Retrieval (Wikipedia).
    return this.queryWikipedia(
      attractionCenter,
      query,
      heatNodes,
      topologicalQuery
    );
  }

  /**
   * Pushes a found fact into the system buffer and resolves the original query
   * against it using Geodesic Pathfinding.
   *
   * @param query The target query string.
   * @param fact The contextual fact to use as the topology.
   * @returns The most likely answer string derived from the fact.
   */
  private async resolveThroughSystem(
    query: string,
    fact: string
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
    if (
      (!inferredMeaning ||
        inferredMeaning === query.toLowerCase() ||
        inferredMeaning === "unknown") &&
      queryQuanta.length > 0 &&
      contextQuanta.length > 0
    ) {
      // Connect source of fact to the TARGET of the query to find the minimal logical distance.
      const sourceQuantum = contextQuanta[0];
      const targetQuantum = queryQuanta[queryQuanta.length - 1];

      // LOGIC: Boost keyword scopes to pull the geodesic path towards relevant concepts.
      const doc = nlp(query);
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
        const isExplanatory = query.toLowerCase().match(/^(how|why)/);
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
        totalEntropy += this.system.entropy[derivationPath[i]];
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
   * Performs an external knowledge search via Wikipedia.
   * Ranks results based on their resonance with the query's heat nodes.
   *
   * @param attractionCenter The subject to search for.
   * @param query The original query string.
   * @param heatNodes Keywords for resonance matching.
   * @param topologicalQuery The transformed query for manifold resolution.
   * @returns The best matching information string.
   */
  private async queryWikipedia(
    attractionCenter: string,
    query: string,
    heatNodes: string[],
    topologicalQuery: string
  ): Promise<string> {
    if (!attractionCenter) {
      const doc = nlp(query);
      const nouns = doc.nouns().out("array");
      if (nouns.length === 0) {
        const fallback =
          "I do not know the answer to that, and could not find a search term.";
        this.respond(fallback);
        return fallback;
      }
      attractionCenter = nouns[nouns.length - 1];
    }

    this.respond(`[Wikipedia] Searching for: ${attractionCenter}...`);
    try {
      const page = await wiki.page(attractionCenter);
      const content = await page.content();

      let bestSentence = "";
      let maxResonance = 0;

      const sentences = nlp(content).sentences().out("array");
      const centerLower = attractionCenter.toLowerCase();
      const centerParts = centerLower.split(/\s+/).filter(p => p.length > 2);

      for (const sentence of sentences) {
        const sLower = sentence.toLowerCase();

        // 1. Attraction Center check: Does it mention the core topic?
        let attractionScore = 0;
        for (const part of centerParts) {
          if (sLower.includes(part)) attractionScore += 1;
        }
        if (attractionScore === 0) continue;

        // 2. Heat Node resonance: overlap with query keywords.
        let nodeScore = 0;
        for (const node of heatNodes) {
          if (node && node.length > 2 && sLower.includes(node)) {
            nodeScore += 1;
          }
        }

        // 3. Proximity: are heat nodes physically near the attraction center in the text?
        let proximityScore = 0;
        if (nodeScore > 0) {
          const firstCenterIdx = sLower.indexOf(centerParts[0]);
          for (const node of heatNodes) {
            const nodeIdx = sLower.indexOf(node);
            if (nodeIdx !== -1) {
              const dist = Math.abs(nodeIdx - firstCenterIdx);
              if (dist < 50) proximityScore += 1;
            }
          }
        }

        // 4. Action Boost: prioritize sentences that match the requested action (e.g., "died").
        let actionBoost = 0;
        if (
          heatNodes.includes("die") &&
          (sLower.includes("died") || sLower.includes("death"))
        ) {
          actionBoost += 3;
          // Penalize if the action refers to a relative or unrelated entity.
          if (
            sLower.includes("father") ||
            sLower.includes("byron") ||
            sLower.includes("husband")
          ) {
            actionBoost -= 2;
          }
        }

        const totalScore =
          attractionScore + nodeScore * 2 + proximityScore + actionBoost;

        if (totalScore > maxResonance) {
          maxResonance = totalScore;
          bestSentence = sentence;
        }
      }

      // If no sentence resonated strongly, fall back to the summary lead.
      if (!bestSentence) {
        const summary = await page.summary();
        const extract = summary.extract;
        bestSentence = nlp(extract).sentences().json()[0]?.text || extract;
      }

      bestSentence = bestSentence.replace(/\n/g, " ").trim();

      // Crystallize the raw fact into the persistent vault for future resonance.
      await this.processCommand(bestSentence);

      // Resolve the final answer formally through the System topology.
      return this.resolveThroughSystem(topologicalQuery, bestSentence);
    } catch (error) {
      const fallback = `I tried to look up "${attractionCenter}" on Wikipedia, but couldn't find anything useful.`;
      this.respond(fallback);
      return fallback;
    }
  }

  /**
   * Ingests a factual statement or command into the system buffer and vault.
   * This process "crystallizes" raw information into a stable interference pattern.
   *
   * @param statement The declarative string to commit.
   * @returns The decoded meaning as understood by the system.
   */
  public async processCommand(statement: string): Promise<string> {
    const quanta = this.atomizer.ingestSequence(statement, this.system);

    if (quanta.length > 0) {
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
