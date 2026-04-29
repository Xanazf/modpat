import type System from "@core_i/System";
import { classifyOperatorToken } from "@core_i/System";
import nlp from "compromise";
import { BaseAtomizer } from "./BaseAtomizer";
import { SYNTAX_ATTRACTORS } from "@config";

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
   */
  public ingestSequence(text: string, system: System): Uint32Array {
    // 1. Manual Atomic Preparation
    // Ensure all structural signifiers are distinct tokens.
    // Ensure |- is NOT split.
    const preparedText = text
      .replace(/\|-/g, " SINK_MARKER ")
      .replace(/([(){}\[\]:;.,+\-*/=<>])/g, " $1 ")
      .replace(/SINK_MARKER/g, "|-");

    const rawTokens = preparedText.split(/\s+/).filter(t => t.length > 0);
    const tokens: { text: string; isOp: boolean; isPlural: boolean }[] = [];

    for (const token of rawTokens) {
      const normal = token.toLowerCase();
      const isStructural = ["(", ")", "{", "}", ":", ",", "+", "|-"].includes(
        normal
      );
      const isHardOp =
        this.hardOperators.has(normal) ||
        ["implies", "=>", "|-"].includes(normal);
      const isMathAtom = ["x", "y", "z", "a", "b", "c", "number"].includes(
        normal
      );
      const isKeyword = SYNTAX_ATTRACTORS.KEYWORDS.has(normal);

      // Simple NLP tagging per token to maintain identity but get basic metadata
      const doc = nlp(token);
      const term = doc.json()[0]?.terms[0] || {};
      const tags = term.tags || [];
      const isVerb =
        tags.includes("Verb") ||
        tags.includes("Copula") ||
        tags.includes("PastTense");
      const isPlural =
        tags.includes("Plural") || normal === "are" || normal === "were";

      tokens.push({
        text: token,
        isOp:
          isStructural ||
          isHardOp ||
          isMathAtom ||
          isVerb ||
          isKeyword ||
          this.logicalAdverbs.has(normal),
        isPlural,
      });
    }

    const sequenceIds = new Uint32Array(tokens.length);
    let currentLoom = 1.0;

    // 2. Physical Materialization
    for (let i = 0; i < tokens.length; i++) {
      const { text, isOp, isPlural } = tokens[i];
      const norm = text.toLowerCase().trim();

      // Update current loom state based on structural signifiers
      if (["function", "calculate", "class"].includes(norm)) currentLoom = 0.0;
      else if (norm === "(") currentLoom = 0.5;
      else if (norm === ")") currentLoom = 1.5;
      else if (norm === "{") currentLoom = 2.0;
      else if (norm === "}") currentLoom = 3.0;
      else if (norm === "executable_code") currentLoom = 4.0;
      else if (norm === "|-") currentLoom = 5.0;

      let mass = isOp ? system.c ** 2 : system.epsilon;
      if (isPlural) mass *= 1.5;

      const scope = this.getSymbolScope(norm);

      // We ALWAYS create a new location during sequence ingestion to preserve
      // the unique physical identity of each token in the functional chain.
      const id = system.createLocation(mass, scope);

      system.operatorClass[id] = classifyOperatorToken(text);
      sequenceIds[i] = id;

      system.posY[id] = i * 0.1;

      let context = currentLoom;
      let depth = 0.5; // Default depth
      let decay = 0.01; // Default decay

      // Task 11: Specificity-based Depth Projection & Triplet Logic
      const isDefinite = norm === "the";
      const isIndefinite = norm === "a" || norm === "an";

      if (isDefinite) {
        depth = 0.1; // High specificity = Low Depth
        system.mass[id] *= 2.0; // "The" is a significant triplet initiator
      } else if (isIndefinite) {
        depth = 0.9; // Low specificity = High Depth
      } else if (["function", "calculate", "class"].includes(norm)) {
        depth = 1.0;
        decay = 0.001;
      } else if (currentLoom >= 0.5 && currentLoom <= 1.5) {
        depth = 0.7;
        decay = 0.005;
      } else if (currentLoom >= 2.0 && currentLoom <= 3.0) {
        depth = 0.4;
        decay = 0.01;
        if (!["{", "}", "return"].includes(norm)) context = 2.5;
      }

      // Triplet Inheritance: if preceded by "the", this particle becomes a specific landmark
      if (i > 0) {
        const prevNorm = tokens[i - 1].text.toLowerCase().trim();
        // Check for "the [x]" or "the [x] [y]"
        if (
          prevNorm === "the" ||
          (i > 1 && tokens[i - 2].text.toLowerCase().trim() === "the")
        ) {
          system.mass[id] *= 4.0; // Significant triplet boost
          depth = 0.1; // Force high specificity
        }
      }

      system.posZ[id] = depth;
      system.posW[id] = context + i * 0.001;

      // Sync Matter layer content
      system.depth[id] = depth;
      system.time[id] = system.posW[id];
      system.decayRate[id] = decay;

      // Finalize 4D Coordinates.
      const words = text
        .toLowerCase()
        .split(/\s+/)
        .filter(w => !["the", "a", "an"].includes(w));
      if (words.length > 0) {
        let avgPosX = 0;
        for (const word of words) avgPosX += this.loader.getScope(word);
        system.posX[id] = avgPosX / words.length;
      } else {
        system.posX[id] = this.loader.getScope(text);
      }

      system.update(id);
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
