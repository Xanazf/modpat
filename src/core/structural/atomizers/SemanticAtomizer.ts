import type System from "@core_i/System";
import { classifyOperatorToken } from "@core_i/System";
import nlp from "compromise";
import { BaseAtomizer } from "./BaseAtomizer";

/**
 * The SemanticAtomizer serves as the Natural Language Interface (NLI) for the logical manifold.
 * It employs Natural Language Processing (NLP) to identify "Massive Bodies" (Verbs/Operators)
 * and "Particles" (Nouns/Atoms), mapping the nuances of human language into physical
 * topological properties within the System.
 */
export default class SemanticAtomizer
  extends BaseAtomizer
  implements Atomic.Engine
{
  /** Tracks the frequency of symbols to calculate informational entropy (surprisal). */
  private symbolFrequency: Map<string, number> = new Map();
  /** Total count of processed tokens for probability calculations. */
  private totalTokens = 0;

  /** Adverbs that signify logical modification or constraints. */
  private logicalAdverbs = new Set([
    "not",
    "only",
    "then",
    "always",
    "never",
    "all",
  ]);
  /** Hardcoded operators that always act as massive attractors in the topology. */
  private hardOperators = new Set([
    "is",
    "are",
    "all",
    "equals",
    "plus",
    "minus",
  ]);

  /**
   * Initializes the semantic atomizer engine.
   */
  public async init(): Promise<void> {}

  /**
   * Calculates the structural Scope (frequency) for a symbol by detecting its
   * semantic role as an operator or operand.
   *
   * @param symbol The string token.
   * @returns The calculated physical scope.
   */
  public getSymbolScope(symbol: string): number {
    const s = symbol.toLowerCase().trim();
    // Identify if the symbol acts as a "hard" logical operator.
    const isOp =
      this.hardOperators.has(s) ||
      ["implies", "=>", "can", "||", "&&", "|-", "for all", "exists"].includes(
        s
      );
    return super.getSymbolScope(s, isOp);
  }

  /**
   * Semantic Ingestion: Maps natural language input to the topological manifold.
   * It performs entity recognition and part-of-speech tagging to group tokens
   * into coherent physical entities.
   *
   * @param text The raw natural language string.
   * @param system The logical manifold to populate.
   * @returns A sequence of quantum IDs representing the materialized semantic tokens.
   */
  public ingestSequence(text: string, system: System): Uint32Array {
    // TODO: distinguish plurality more granularly:
    // - "one" = baseline;
    // - "all" = "one" * "a lot";
    //  - very broad scope && very high mass;
    //  - "a lot" = maxilon * 0.5?;
    // - "some" || "few" = "one" * 1.5;

    // Inject custom logical semantics into the NLP engine to improve classification.
    const plugin = {
      words: {
        equals: "Verb",
        plus: "Conjunction",
        minus: "Conjunction",
        then: "Conjunction",
        if: "Conjunction",
        all: "Conjunction",
        "|-": "Conjunction",
        not: "Adverb",
      },
    };
    nlp.plugin(plugin);

    const doc = nlp(text);
    const json = doc.json();

    if (!json || json.length === 0) return new Uint32Array(0);

    const tokens: { text: string; isOp: boolean; isPlural: boolean }[] = [];

    // Map natural language terms to Topological Tokens by iterating through sentences.
    for (const sentence of json) {
      const terms = sentence.terms;
      let tempEntity: string[] = [];
      let lastEntityType: string | null = null;
      let tempIsPlural = false;

      // Helper to push a accumulated entity (noun phrase) into the token list.
      const pushTemp = () => {
        if (tempEntity.length > 0) {
          const cleanText = tempEntity
            .join(" ")
            .replace(/[.,?!]+$/, "")
            .trim();
          if (cleanText)
            tokens.push({
              text: cleanText,
              isOp: false,
              isPlural: tempIsPlural,
            });
          tempEntity = [];
          lastEntityType = null;
          tempIsPlural = false;
        }
      };

      for (const term of terms) {
        const tags = term.tags || [];
        const normal = (term.normal || term.text).toLowerCase();

        // Plurality detection
        const isPlural =
          tags.includes("Plural") || normal === "are" || normal === "were";

        // Determine if the term acts as a logical operator (Massive Body).
        const isVerb = tags.includes("Verb") || tags.includes("Copula");
        const isPrep = tags.includes("Preposition");
        const isConj = tags.includes("Conjunction");
        const isLogicAdverb =
          tags.includes("Adverb") && this.logicalAdverbs.has(normal);
        const isHardOp = this.hardOperators.has(normal);
        const isSpecialOp = term.text.includes("|-");

        const isOp =
          isVerb ||
          isPrep ||
          isConj ||
          isLogicAdverb ||
          isSpecialOp ||
          isHardOp;

        if (isOp) {
          // Push any pending entity before processing the operator.
          pushTemp();
          const cleanOp = term.text.replace(/[.,?!]+$/, "").trim();
          if (cleanOp) tokens.push({ text: cleanOp, isOp: true, isPlural });
          continue;
        }

        // Entity recognition for stable grouping (e.g., "Albert Einstein" as one entity).
        const entityType = this.getEntityType(tags);
        if (lastEntityType === null || lastEntityType === entityType) {
          tempEntity.push(term.text.replace(/[.,?!]+$/, "").trim());
          lastEntityType = entityType;
        } else {
          pushTemp();
          tempEntity.push(term.text.replace(/[.,?!]+$/, "").trim());
          lastEntityType = entityType;
        }
        tempIsPlural = isPlural;
      }
      // Final push for the last entity in the sentence.
      pushTemp();
    }

    const sequenceIds = new Uint32Array(tokens.length);

    // Calculate Physical Interaction parameters for each token (Mass, Scope, Entropy).
    for (let i = 0; i < tokens.length; i++) {
      const { text, isOp, isPlural } = tokens[i];
      const s = text.toLowerCase().trim();

      // 1. Calculate Logical Mass (Attraction toward concept).
      // Operators are massive attractors; semantic atoms are light particles.
      let mass = isOp ? system.c ** 2 : system.epsilon;

      // Plural constructs possess a higher semantic weight in the manifold.
      if (isPlural) {
        mass *= 1.5;
      }

      // 2. Map the token to its unique Frequency Field (Scope).
      // Append a plural modifier to the scope hash so singular and plural forms occupy distinct sub-spaces.
      const scopeText = isPlural ? `${text}_PLURAL` : text;
      const scope = this.getSymbolScope(scopeText);

      // 3. Materialize the Precept in the System manifold.
      const id = system.createLocation(mass, scope);
      system.operatorClass[id] = classifyOperatorToken(text);
      sequenceIds[i] = id;

      // 4. Project Coordinates into the Manifold.
      // posX: Semantic proximity via UMAP.
      // For multi-word entities, calculate the centroid of individual word scopes.
      const words = text
        .toLowerCase()
        .split(/\s+/)
        .filter(w => !["the", "a", "an"].includes(w));
      if (words.length > 0) {
        let avgPosX = 0;
        for (const word of words) {
          avgPosX += this.loader.getScope(word);
        }
        system.posX[id] = avgPosX / words.length;
      } else {
        system.posX[id] = this.loader.getScope(text);
      }

      // posY: Temporal displacement based on sequence order.
      system.posY[id] = i * 0.1;

      // 5. Calculate Surprisal (Informational Entropy).      // Entropy = -log2(probability), representing the logical uncertainty of a symbol.
      this.totalTokens++;
      const freq = (this.symbolFrequency.get(s) || 0) + 1;
      this.symbolFrequency.set(s, freq);
      system.entropy[id] = -Math.log2(freq / this.totalTokens);
    }

    return sequenceIds;
  }

  /**
   * Helper to identify the type of an entity for coherent grouping.
   *
   * @param tags NLP tags for the term.
   * @returns A string identifier for the entity type.
   */
  private getEntityType(tags: string[]): string {
    if (tags.includes("Person")) return "Person";
    if (tags.includes("Date") || tags.includes("Value")) return "Date";
    if (tags.includes("Place")) return "Place";
    if (tags.includes("Organization")) return "Organization";
    return "Noun";
  }

  /**
   * Decodes a manifold sequence back into human-readable text by reversing
   * the scope-to-symbol mapping.
   *
   * @param sequenceIds The sequence of quantum IDs.
   * @param system The logical manifold.
   * @returns The reconstructed natural language string.
   */
  public decodeSequence(sequenceIds: Uint32Array, system: System): string {
    const output: string[] = [];
    for (let i = 0; i < sequenceIds.length; i++) {
      output.push(this.resolveSymbolFromScope(system.scope[sequenceIds[i]]));
    }
    return output.join(" ");
  }
}
