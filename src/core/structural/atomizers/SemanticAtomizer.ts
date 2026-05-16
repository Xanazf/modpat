import { DOPAT_CONFIG, SYNTAX_ATTRACTORS } from "@config";
import type System from "@core_i/System";
import { classifyOperatorToken, OperatorClass, SlotType } from "@core_i/System";
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
   */
  public ingestSequence(text: string, system: Root.ManifoldView): Uint32Array {
    // 1. Manual Atomic Preparation
    // Ensure all structural signifiers are distinct tokens.
    // Ensure |- is NOT split.
    const preparedText = text
      .replace(/\|-/g, " SINK_MARKER ")
      .replace(/([(){}[\]:;.,+\-*/=<>])/g, " $1 ")
      .replace(/SINK_MARKER/g, "|-");

    const rawTokens = preparedText.split(/\s+/).filter(t => t.length > 0);
    const tokens: {
      text: string;
      isOp: boolean;
      isPlural: boolean;
      isVerb: boolean;
    }[] = [];

    // Parse the entire token sequence once instead of one nlp() call per token.
    const fullDoc = nlp(rawTokens.join(" "));
    const termsByIndex: Array<{ tags?: string[] }> =
      fullDoc.json()[0]?.terms ?? [];

    for (let ti = 0; ti < rawTokens.length; ti++) {
      const token = rawTokens[ti];
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

      const term = termsByIndex[ti] ?? {};
      const tags: string[] = (term as any).tags ?? [];
      // A gerund following a determiner (e.g. "the running dog") may be tagged
      // Adjective in context rather than Verb; treat both as verb-like so the
      // gerund-disambiguation branch in the materialization loop still fires.
      const isGerundInContext =
        normal.endsWith("ing") &&
        ti > 0 &&
        ["the", "a", "an"].includes(rawTokens[ti - 1].toLowerCase());
      const isVerb =
        tags.includes("Verb") ||
        tags.includes("Copula") ||
        tags.includes("PastTense") ||
        isGerundInContext;
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
        isVerb,
      });
    }

    const sequenceIds = new Uint32Array(tokens.length);
    let currentLoom = 1.0;
    let prevId = 0; // NULL

    // 2. Physical Materialization
    for (let i = 0; i < tokens.length; i++) {
      const { text, isOp, isPlural, isVerb } = tokens[i];
      const norm = text.toLowerCase().trim();

      // Update current loom state based on structural signifiers
      if (["function", "calculate", "class"].includes(norm)) currentLoom = 0.0;
      else if (norm === "(") currentLoom = 0.5;
      else if (norm === ")") currentLoom = 1.5;
      else if (norm === "{") currentLoom = 2.0;
      if (norm === "}") currentLoom = 3.0;
      else if (norm === "executable_code") currentLoom = 4.0;
      else if (norm === "|-") currentLoom = 5.0;

      let mass = isOp ? system.c ** 2 : system.c;
      if (isPlural) mass *= 1.5;

      const scope = this.getSymbolScope(norm);

      // We ALWAYS create a new location during sequence ingestion to preserve
      // the unique physical identity of each token in the functional chain.
      const id = system.createLocation(mass, scope);

      // Link sequence continuity
      if (prevId !== 0) {
        system.PartLayer[prevId] = id;
        system.ComplexLayer[id] = prevId;
      }
      prevId = id;

      let opClass = classifyOperatorToken(text);
      if (opClass === OperatorClass.None && isVerb) {
        // Issue A — gerund disambiguation: if a -ing verb directly follows a determiner
        // (e.g. "the running dog"), treat it as a Modifier rather than an Action.
        // Without this, "running" in "the running dog" and "she was running" get the
        // same operator class despite playing different grammatical roles.
        const prevNormText =
          i > 0 ? tokens[i - 1].text.toLowerCase().trim() : "";
        const isGerundAdjective =
          norm.endsWith("ing") && ["the", "a", "an"].includes(prevNormText);
        opClass = isGerundAdjective
          ? OperatorClass.Modifier
          : OperatorClass.Action;
      }
      system.operatorClass[id] = opClass;
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

      // Triplet Inheritance: if preceded by "the", this particle becomes a specific landmark.
      // Issue B — cap the multiplier so deeply nested "the the the X" structures don't
      // produce runaway mass (64×, 256×…) that distorts the potential field for unrelated queries.
      if (i > 0) {
        const prevNorm = tokens[i - 1].text.toLowerCase().trim();
        if (
          prevNorm === "the" ||
          (i > 1 && tokens[i - 2].text.toLowerCase().trim() === "the")
        ) {
          system.mass[id] *= DOPAT_CONFIG.atomizer.INHERITANCE_BASE_FACTOR;
          depth = 0.1;
        }
      }
      // Apply cap relative to the initial mass so the multiplier never exceeds MAX_INHERITANCE_MASS_FACTOR.
      const baseMassForCap = isOp ? system.c ** 2 : system.c;
      system.mass[id] = Math.min(
        system.mass[id],
        baseMassForCap * DOPAT_CONFIG.atomizer.MAX_INHERITANCE_MASS_FACTOR
      );

      system.posZ[id] = depth;
      // posW = temporal freshness: starts at maximum (1.0) for every newly
      // ingested precept and decays via Runtime.tick().  Formerly held a
      // context-hash + sequence-offset value, which provided no decay signal.
      system.posW[id] = DOPAT_CONFIG.PHYSICS.AGE_FRESHNESS;

      // Sync Matter layer content (time drives entropyRate; kept separate from posW)
      system.depth[id] = depth;
      system.time[id] = i * 0.01; // sequence position, used for entropyRate
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

    // Register the start of this sequence so Resolver can use the ring fast-path
    if (sequenceIds.length > 0) {
      system.setSequenceStart(system.scope[sequenceIds[0]], sequenceIds[0]);
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
   * Ingests an abstract code pattern template into the manifold and sets slotType
   * on each VAR_N precept so the Mapper can perceive slot roles during path relaxation.
   *
   * posZ is assigned by slot depth:
   *   Body      → 0.9  (open continuation, deepest, pulls sub-patterns in)
   *   Condition → 0.7  (boolean guard, near-deep)
   *   Parameter → 0.5  (argument list, mid)
   *   TypeHint  → 0.3  (annotation, shallow)
   *   Leaf      → 0.1  (terminal identifier, shallowest)
   *
   * @param template  - Abstract pattern string, e.g. "function VAR_0(VAR_1) { VAR_BODY }"
   * @param slotTypes - Map from VAR index to SlotType bitmask.
   * @param system    - The live manifold.
   */
  public ingestPattern(
    template: string,
    slotTypes: Map<number, SlotType>,
    system: Root.ManifoldView
  ): Uint32Array {
    // Tokenize using the same preparation step as ingestSequence.
    const preparedText = template
      .replace(/\|-/g, " SINK_MARKER ")
      .replace(/([(){}[\]:;.,+\-*/=<>])/g, " $1 ")
      .replace(/SINK_MARKER/g, "|-");

    const rawTokens = preparedText.split(/\s+/).filter(t => t.length > 0);
    const sequenceIds = new Uint32Array(rawTokens.length);

    for (let i = 0; i < rawTokens.length; i++) {
      const token = rawTokens[i];
      const norm = token.trim().toLowerCase();

      // Detect VAR_N tokens.
      const varMatch = norm.match(/^var_(\d+)$/);
      if (varMatch) {
        const varId = parseInt(varMatch[1], 10);
        const st = slotTypes.get(varId) ?? SlotType.Leaf;

        const scope = this.getSymbolScope(norm);
        const id = system.createLocation(system.epsilon, scope);
        system.operatorClass[id] = OperatorClass.None;
        system.slotType[id] = st;

        // Assign posZ by slot depth so the Mapper's potential field can differentiate.
        const depth =
          st & SlotType.Body
            ? 0.9
            : st & SlotType.Condition
              ? 0.7
              : st & SlotType.Parameter
                ? 0.5
                : st & SlotType.TypeHint
                  ? 0.3
                  : 0.1; // Leaf

        system.posZ[id] = depth;
        system.posY[id] = i * 0.1;
        system.posW[id] = DOPAT_CONFIG.PHYSICS.AGE_FRESHNESS;
        system.depth[id] = depth;
        system.update(id);
        sequenceIds[i] = id;
        continue;
      }

      // All other tokens, delegates to standard ingestSequence logic for one token.
      const singleTokenIds = this.ingestSequence(token, system);
      sequenceIds[i] = singleTokenIds[0];
    }

    if (sequenceIds.length > 0) {
      system.setSequenceStart(system.scope[sequenceIds[0]], sequenceIds[0]);
    }

    return sequenceIds;
  }

  /**
   * Decodes a manifold sequence back into human-readable text by reversing
   * the scope-to-symbol mapping.
   *
   * @param sequenceIds The sequence of quantum IDs.
   * @param system The logical manifold.
   * @returns The reconstructed natural language string.
   */
  public decodeSequence(
    sequenceIds: Uint32Array,
    system: Root.ManifoldView
  ): string {
    const output: string[] = [];
    for (let i = 0; i < sequenceIds.length; i++) {
      output.push(this.resolveScope(system.scope[sequenceIds[i]]) ?? "<?>");
    }
    return output.join(" ");
  }
}
