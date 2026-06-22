import { DOPAT_CONFIG } from "@config";
import { OperatorClass, type SlotType } from "@core_i/helpers/enums";
import { classifyOperatorToken } from "@core_i/helpers/functions";
import { NUMBER_LINE_SCALE } from "@skill_cogi/Reduction";
import { BaseAtomizer, COOCCURRENCE_STOPWORDS } from "./BaseAtomizer";

/** Parses an integer numeral; returns null for non-numeric tokens. */
function numeralValue(token: string): number | null {
  if (!/^-?\d+$/.test(token)) return null;
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

/**
 * The Atomizer is a low-level logical parser responsible for converting
 * symbolic strings into physical "Massive Bodies" within the logical manifold.
 *
 * It materializes abstract language into a concrete state-space where
 * operators act as gravitational attractors and variables act as particles.
 */
export default class Atomizer extends BaseAtomizer implements Atomic.Engine {
  /** Identifies operators that signify a right-directional logical conclusion. */
  private rightDirectionalRegex = /\|-|\btherefore\b/i;

  /**
   * Initializes the atomizer engine.
   */
  public async init(): Promise<void> {}

  /**
   * Calculates the structural Scope (frequency) for a symbol. Auto-detects
   * operator status from the token unless the caller supplies an explicit
   * override (numerals, for instance, must not be treated as operators even
   * when they appear next to one).
   *
   * @param symbol The string token.
   * @param isOperator Optional override for the operator flag.
   * @returns The calculated physical scope.
   */
  public getSymbolScope(symbol: string, isOperator?: boolean): number {
    const flag =
      isOperator ?? classifyOperatorToken(symbol) !== OperatorClass.None;
    return super.getSymbolScope(symbol, flag);
  }

  /**
   * Ingests a logical sequence, mapping each token to a coordinate in the
   * Space-Time manifold of the logic system.
   *
   * @param text The raw logical statement or sequence.
   * @param system The logical manifold to populate.
   * @returns A sequence of quantum IDs representing the materialized tokens.
   */
  public ingestSequence(text: string, system: Root.ManifoldView): Uint32Array {
    // Split the text into tokens while preserving logical operators and punctuation.
    const tokens = text
      .split(/(for\s+all|=>|\|-|&&|\|\||\s+|\b|\(|\))/i)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const sequenceIds = new Uint32Array(tokens.length);
    let prevId = 0; // NULL

    // Scope multiset of the whole sequence - used so a cold-start token can
    // ground toward the referents of its co-occurring tokens (Phase 5). The
    // co-occurrence basis keeps only CONTENT tokens (no operators, no stop-words),
    // since syntactic glue co-occurs with everything and would collapse topics.
    // Only built when the (default-off) cold-start channel is active.
    const seqScopes = tokens.map(t => this.getSymbolScope(t));
    const coocBasis = DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED
      ? seqScopes.filter(
          (_s, i) =>
            classifyOperatorToken(tokens[i]) === OperatorClass.None &&
            !COOCCURRENCE_STOPWORDS.has(tokens[i].toLowerCase().trim())
        )
      : undefined;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const isOperator = classifyOperatorToken(token) !== OperatorClass.None;

      // 1. Calculate Logical Mass (m = E/c^2).
      // Operators are massive attractors that define the "gravitational" field of the statement.
      // Variables are near-weightless particles that flow between these attractors.
      let mass = isOperator ? system.c ** 2 : system.c;

      // Right-directional operators (conclusions) are modeled with Negative Mass.
      // This repels the current logic path, forcing it to "fall" toward a new state.
      if (this.rightDirectionalRegex.test(token)) {
        mass *= -1;
      }

      // 2. Map the token to its unique Frequency Field (Scope).
      const scope = seqScopes[i];

      // 3. Materialize the token as a physical location in the System manifold.
      const id = system.createLocation(mass, scope);

      // Link sequence continuity
      if (prevId !== 0) {
        system.PartLayer[prevId] = id;
        system.ComplexLayer[id] = prevId;
      }
      prevId = id;

      system.operatorClass[id] = classifyOperatorToken(token);
      sequenceIds[i] = id;

      // 4. Project the token into the Dual-Layer Manifold.
      // Matter Layer content:
      // Depth (Energy) and Time (Age) for logic atoms.
      system.depth[id] = isOperator ? 1.0 : 0.5;
      system.time[id] = i * 0.01;

      // Coordinate Layer positioning:
      // posX: Phase 5 - the referent's grounded position when one exists;
      // the GloVe/UMAP 1D reduction is demoted to a cold-start hint.
      system.posX[id] = this.groundedPosX(
        system,
        scope,
        this.loader.getScope(token),
        id,
        coocBasis
      );
      // posY: Structural kind coordinate.
      system.posY[id] = i * 0.1;
      // posZ: Energy coordinate (matches Depth content).
      system.posZ[id] = system.depth[id];
      // posW: Age coordinate (matches Time content).
      system.posW[id] = DOPAT_CONFIG.PHYSICS.AGE_FRESHNESS; // freshly ingested = maximally recent

      // Number-line grounding: integer numerals get posW = value × scale and
      // decayRate = 0, so the geometry of W carries the value and additive
      // reductions compose by traversal. (Reduction.ts uses the same scale.)
      const numVal = numeralValue(token);
      if (numVal !== null) {
        system.posW[id] = numVal * NUMBER_LINE_SCALE;
        system.decayRate[id] = 0;
      }

      // Stance: a content token directly preceded by a negation is placed at the
      // antipode of its concept (X/Y/Z reflected, number-line W preserved), so
      // "X" and "not X" cancel under wave superposition (see BaseAtomizer). When
      // there is no "not", a LEXICAL antonym of an already-placed concept gets the
      // same antipodal stance ("cold" opposite "hot"); the two are mutually
      // exclusive so opposition is never applied twice (step 9).
      if (
        !isOperator &&
        i > 0 &&
        classifyOperatorToken(tokens[i - 1]) === OperatorClass.Inversion
      ) {
        this.applyContrastStance(system, id, scope);
      } else if (!isOperator) {
        this.applyLexicalAntonymStance(system, id, token);
      }

      // Finalize derived properties.
      system.update(id);
    }

    return sequenceIds;
  }

  /** Pattern ingestion is handled by SemanticAtomizer; LogicAtomizer delegates to ingestSequence. */
  public ingestPattern(
    template: string,
    _slotTypes: Map<number, SlotType>,
    system: Root.ManifoldView
  ): Uint32Array {
    return this.ingestSequence(template, system);
  }

  /**
   * Reconstructs the original string sequence from the high-frequency Scope parameters
   * of the precepts stored in the system.
   *
   * @param sequenceIds The sequence of quantum IDs to decode.
   * @param system The logical manifold containing the physical state.
   * @returns The reconstructed string statement.
   */
  public decodeSequence(
    sequenceIds: Uint32Array,
    system: Root.ManifoldView
  ): string {
    const output: string[] = [];
    for (let i = 0; i < sequenceIds.length; i++) {
      const id = sequenceIds[i];
      // Resolve the symbol by reversing the Scope-to-Index mapping.
      output.push(this.resolveScope(system.scope[id]) ?? "<?>");
    }
    return output.join(" ");
  }
}
