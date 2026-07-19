/**
 * Language - the translation boundary between raw text and the manifold.
 *
 * The Language class translates in both directions:
 *   Ingest:  raw text -> tokenized, atomized precepts in the System
 *   Express: precept IDs -> decoded text
 *
 * It does NOT reason, route, or decide what to do with parsed content.
 * All reasoning lives in the Mapper. Language is pure translation.
 *
 * Consolidates translation logic that was previously scattered across
 * Listener, Talker, and LiveInference.
 */

import { DOPAT_CONFIG } from "@config";
import { OperatorClass, type SystemRef } from "@core_i/System";
import type { BridgeCandidate } from "@core_i/Traveler";
import { buildGraphFromText } from "@core_s/grounding/TextGraph";
import { groundTextGraphIntoSystem } from "@core_s/grounding/TextGrounding";
import type Store from "@core_s/Memory";
import { isIdentityQueryAboutSelf, shiftPerspective } from "@props/Identity";
import logger from "@utils/SpectralLogger";
import { random } from "@utils/seededRandom";
import nlp from "compromise";
import { buildExplanation, WorkingMemory } from "./WorkingMemory";

// ---- Intent classification ------------------------------------------------

/** Structural classification of the surface form of text input. */
export type ParsedIntent = "question" | "assertion" | "code" | "feedback";

/** Feedback polarity extracted from feedback-classified input. */
export type FeedbackPolarity = "positive" | "negative" | null;

// ---- Code intent detection ------------------------------------------------

const CODE_ACTION_PATTERN =
  /\b(write|generate|create|implement|show me how to|how (?:do|would) (?:i|you))\b/i;
const CODE_NOUN_PATTERN =
  /\b(function|method|class|code|snippet|example|algorithm|sort|fibonacci|factorial|binary|search|tree|graph|linked.?list|queue|stack|hash.?map)\b/i;
const WH_QUESTION_PATTERN =
  /^(what|who|where|when|why|how\s+is|how\s+are|how\s+does)\b/i;

/**
 * Returns true when the query has a code-synthesis intent based on structural
 * heuristics (action verbs + code nouns). This is a classification of surface
 * form, not a routing decision.
 */
export function isCodeIntent(query: string): boolean {
  if (query.includes("|-")) return true;
  if (CODE_ACTION_PATTERN.test(query)) return true;
  return (
    CODE_NOUN_PATTERN.test(query) && !WH_QUESTION_PATTERN.test(query.trim())
  );
}

// ---- Bigram vocabulary for keyword extraction ----------------------------

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

// ---- Code input detection (AST-based) ------------------------------------

/**
 * AST node types that the code path recognises.
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
 * Returns true when the input looks like executable code rather than
 * natural language. Two-stage check: fast heuristic then AST parse.
 */
function isCodeInput(text: string): boolean {
  if (
    !/[{;]/.test(text) &&
    !/\bfunction\b|\bconst\s+\w|\blet\s+\w|\bvar\s+\w|\bclass\s+\w/.test(text)
  ) {
    return false;
  }
  try {
    const { parse } = require("abstract-syntax-tree");
    const ast: import("abstract-syntax-tree").AstNode = parse(text, {
      module: false,
    });
    return (ast.body ?? []).some(node => CODE_NODE_TYPES.has(node.type));
  } catch {
    return false;
  }
}

// ---- Language class -------------------------------------------------------

export class Language {
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  private atomizer: Atomic.Engine;
  private store: Store | null;

  /** Short-term conversational context. */
  public readonly workingMemory: WorkingMemory;

  /** Response callback - emits text to the output channel. */
  private _respond: (msg: string) => void;

  /**
   * TRAVELER step 1 - Embedding-derived positions recorded before pole
   * override.  Keyed by atom ID; each value is [posX, posY, posZ, posW] at
   * the point the atomizer placed the atom.  Consumed by the settling
   * simulation in Traveler.observeSettlingGradient() (step 3).
   */
  private _driftTargets = new Map<
    number,
    readonly [number, number, number, number]
  >();

  constructor(
    system: Root.ManifoldView | SystemRef,
    atomizer: Atomic.Engine,
    opts: {
      store?: Store | null;
      workingMemory?: WorkingMemory;
      respond?: (msg: string) => void;
    } = {}
  ) {
    const { SystemRef: SysRef } = require("@core_i/System");
    this.systemRef = system instanceof SysRef ? system : new SysRef(system);
    this.atomizer = atomizer;
    this.store = opts.store ?? null;
    this.workingMemory = opts.workingMemory ?? new WorkingMemory();
    this._respond =
      opts.respond ?? ((msg: string) => logger.log(`[Language]: ${msg}`));
  }

  public setRespond(respond: (msg: string) => void): void {
    this._respond = respond;
  }

  public getRespond(): (msg: string) => void {
    return this._respond;
  }

  public respond(msg: string): void {
    this._respond(msg);
  }

  // ---- Ingest direction ---------------------------------------------------

  /**
   * Tokenizes, atomizes, and classifies text. Returns the manifold IDs and
   * a structural intent classification. Does NOT reason about the content.
   */
  public ingest(text: string): Discourse.IngestResult {
    // Feedback detection (structural pattern matching, not reasoning)
    const feedbackPolarity = this.detectFeedbackPolarity(text);
    let correction: string | null = null;
    if (feedbackPolarity === "negative") {
      const correctionMatch = text.match(
        /^(?:no|incorrect|wrong|false)[,;]\s*(.+)$/i
      );
      if (correctionMatch) {
        const corrText = correctionMatch[1].trim();
        if (corrText.length > 3) correction = corrText;
      }
    }

    if (feedbackPolarity !== null) {
      // Feedback doesn't get fully ingested - just classify and return empty IDs
      return {
        ids: new Uint32Array(0),
        intent: "feedback",
        feedbackPolarity,
        correction,
        shifted: text,
        isIdentityQuery: false,
        topologicalQuery: text,
        attractionCenter: "",
        isArithmeticQuery: false,
        isOrdinalQuery: false,
        heatNodes: [],
        signature: null,
      };
    }

    // Perspective shift
    const sanitizedQuery = text.replace(/\?$/, "").trim();
    const wasIdentityQuery = isIdentityQueryAboutSelf(text);
    const shifted = shiftPerspective(sanitizedQuery);

    // Intent classification
    const doc = nlp(text);
    const isQuestion = doc.questions().length > 0 || text.trim().endsWith("?");
    let intent: ParsedIntent;

    if (isCodeInput(text)) {
      intent = "code";
    } else if (isCodeIntent(text)) {
      intent = "code";
    } else if (
      isQuestion ||
      text.match(/^(what|who|where|how|why|is|are|can|do|does)\b/i)
    ) {
      intent = "question";
    } else {
      intent = "assertion";
    }

    // Build topological query form
    const {
      topologicalQuery,
      attractionCenter,
      isArithmeticQuery,
      isOrdinalQuery,
    } = this.extractTopologicalQuery(shifted, text);

    // Extract heat nodes for keyword matching
    const heatNodes = this.extractHeatNodes(text);

    // Ingest into manifold
    const ids = this.atomizer.ingestSequence(topologicalQuery, this.system);

    // TRAVELER step 1: override positions to pole + jitter; record drift targets.
    this._poleSettle(ids);

    // Compute signature
    let signature: string | null = null;
    if (this.store && ids.length > 0) {
      const { signature: sig } = this.store.abstractSequence(ids);
      signature = sig;
    }

    return {
      ids,
      intent,
      feedbackPolarity: null,
      correction: null,
      shifted,
      isIdentityQuery: wasIdentityQuery,
      topologicalQuery,
      attractionCenter,
      isArithmeticQuery,
      isOrdinalQuery,
      heatNodes,
      signature,
    };
  }

  /**
   * Classify the intent of text without ingesting it into the manifold.
   */
  public parse(text: string): ParsedIntent {
    const feedbackPolarity = this.detectFeedbackPolarity(text);
    if (feedbackPolarity !== null) return "feedback";
    if (isCodeInput(text)) return "code";
    const doc = nlp(text);
    const isQuestion = doc.questions().length > 0 || text.trim().endsWith("?");
    if (
      isQuestion ||
      text.match(/^(what|who|where|how|why|is|are|can|do|does)\b/i) ||
      isCodeIntent(text)
    ) {
      return "question";
    }
    return "assertion";
  }

  // ---- Express direction --------------------------------------------------

  /**
   * Decode a sequence of precept IDs back into text.
   */
  public express(ids: Uint32Array): string {
    return this.atomizer.decodeSequence(ids, this.system);
  }

  // ---- Reference resolution -----------------------------------------------

  /**
   * Resolve pronouns ("it", "this", "that") against WorkingMemory.
   */
  public resolveReferences(text: string): string {
    return this.workingMemory.resolveReferences(text);
  }

  /**
   * Rewrite second-person input to first-person.
   * "who are you?" -> "i am", "your X" -> "my X", etc.
   */
  public shiftPerspective(text: string): string {
    return shiftPerspective(text);
  }

  // ---- Context management -------------------------------------------------

  /**
   * Push a conclusion into working memory so future turns can reference it.
   */
  public recordConclusion(
    query: string,
    result: string,
    conclusionScope: number,
    conclusionId: number,
    bridges: BridgeCandidate[] = []
  ): void {
    const explanation = buildExplanation(bridges, result);
    this.workingMemory.push({
      query,
      conclusion: result.trim(),
      conclusionScope,
      conclusionId,
      explanation,
    });
  }

  /**
   * Returns context scopes from working memory for Mapper warm-start.
   */
  public contextScopes(): Set<number> {
    return new Set(this.workingMemory.contextScopes());
  }

  // ---- Identity -----------------------------------------------------------

  public isIdentityQuery(text: string): boolean {
    return isIdentityQueryAboutSelf(text);
  }

  public isCodeIntentQuery(text: string): boolean {
    return isCodeIntent(text);
  }

  // ---- Assertion ingestion ------------------------------------------------

  /** Tokens that signal a syntactic placeholder. */
  private static readonly PLACEHOLDER_RE =
    /^\[\]$|^\[\??\]$|^\?$|^_+$|^__\w*__$/;

  /**
   * Ingests a declarative assertion into the manifold and vault.
   * Performs contradiction detection, SVO crystallization, and raw_facts
   * insertion (was Talker.processCommand).
   *
   * Assumes `ids` are already the ingested quanta for `text` (provided by
   * Language.ingest → passed through the ASSERTION skill context).
   */
  public async ingestAssertion(
    text: string,
    ids: Uint32Array
  ): Promise<string> {
    if (!this.store) return `Ignored (no store): "${text}"`;

    const statement_ = shiftPerspective(text);
    const doc = nlp(statement_);

    // Contradiction detection
    let invertedStatement = "";
    if (doc.has("#Negative")) {
      invertedStatement = doc.sentences().toPositive().text();
    } else {
      invertedStatement = doc.sentences().toNegative().text();
    }
    if (invertedStatement && invertedStatement !== statement_) {
      const contradicts = await this.store.rawFactExists(invertedStatement);
      if (contradicts) {
        const invertedSig = this.store.signatureForText(invertedStatement);
        await this.store.adjustEnergy(invertedSig, -0.5);
        const response = `[Logic Trap Detected]: Input contradicts known topological signature. Cached confidence penalized.`;
        this.respond(response);
        return response;
      }
    }

    const quanta =
      ids.length > 0
        ? ids
        : this.atomizer.ingestSequence(statement_, this.system);

    if (quanta.length === 0) {
      const response = `Ignored (Unprocessable Input): "${text}"`;
      this.respond(response);
      return response;
    }

    // Grammar-grounded relational geometry (PARITY §3.1 route (a)). Runs
    // AFTER the logic-trap check (contradicted facts never land) and is
    // purely additive: the ordered `quanta` sequence and everything that
    // consumes it below are untouched. Pronouns resolve against working
    // memory before parsing; a graph needs >= 2 nodes and >= 1 relation to
    // be worth landing.
    if (DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_INGESTION_ENABLED) {
      try {
        const resolved = this.workingMemory.resolveReferences(statement_);
        const graph = buildGraphFromText(resolved);
        if (
          graph.nodes.length >= 2 &&
          graph.edges.length + (graph.contrasts?.length ?? 0) >= 1
        ) {
          groundTextGraphIntoSystem(graph, this.system, this.atomizer);
        }
      } catch (e) {
        logger.error("[TextGraph] grounding failed:", e);
      }
    }

    const { signature } = this.store.abstractSequence(quanta);

    // Self-loop crystallization so Learner's JOIN works
    await this.store.crystallizeProof(quanta, quanta, 1.0);

    // SVO split crystallization
    {
      const sinkScope = this.atomizer.getSymbolScope("|-", false);
      const sinkCandidates =
        sinkScope > 0 ? [...this.system.getIdsByScope(sinkScope)] : [];
      let sinkId = sinkCandidates.find(
        id =>
          this.system.isAllocated(id) &&
          this.system.operatorClass[id] === OperatorClass.Sink
      );
      if (sinkId === undefined && sinkScope > 0) {
        sinkId = this.system.createLocation(
          this.system.c ** 2,
          sinkScope,
          "language_sink_init"
        );
        this.system.operatorClass[sinkId] = OperatorClass.Sink;
        this.system.posW[sinkId] = DOPAT_CONFIG.PHYSICS.AGE_FRESHNESS;
        this.system.update(sinkId);
      }
      if (sinkId !== undefined) {
        let opIdx = -1;
        for (let i = 0; i < quanta.length; i++) {
          const cls = this.system.operatorClass[quanta[i]];
          if (
            cls === OperatorClass.IdentityShift ||
            cls === OperatorClass.Action
          ) {
            opIdx = i;
            break;
          }
        }
        if (opIdx > 0 && opIdx < quanta.length - 1) {
          const probeIds = new Uint32Array([
            ...quanta.subarray(0, opIdx + 1),
            sinkId,
          ]);
          const objectIds = quanta.subarray(opIdx + 1);
          const hasArithmetic = Array.from(quanta.subarray(0, opIdx + 1)).some(
            id => this.system.operatorClass[id] === OperatorClass.Arithmetic
          );
          const energy = hasArithmetic ? 3.0 : 1.0;
          await this.store.crystallizeProof(probeIds, objectIds, energy);

          // Commutative arithmetic: crystallize reversed operands for + and *
          if (hasArithmetic && opIdx === 3 && quanta.length >= 5) {
            const arithmeticOpId = quanta[1];
            if (
              this.system.operatorClass[arithmeticOpId] ===
              OperatorClass.Arithmetic
            ) {
              const opLabel =
                this.atomizer.resolveScope(this.system.scope[arithmeticOpId]) ??
                "";
              const isCommutative = opLabel === "plus" || opLabel === "times";
              const leftId = quanta[0];
              const rightId = quanta[2];
              if (
                isCommutative &&
                this.system.scope[leftId] !== this.system.scope[rightId]
              ) {
                const reversedProbe = new Uint32Array([
                  rightId,
                  arithmeticOpId,
                  leftId,
                  quanta[3],
                  sinkId,
                ]);
                await this.store.crystallizeProof(
                  reversedProbe,
                  objectIds,
                  energy
                );
              }
            }
          }
        }
      }
    }

    // Persist to raw_facts
    try {
      const stmt = await this.store.connection.prepare(
        `INSERT INTO raw_facts (fact, source, confidence, ingested_at, signature) VALUES (?, 'user', 1.0, ?, ?) ON CONFLICT DO NOTHING`
      );
      stmt.bindVarchar(1, statement_);
      stmt.bindBigInt(2, BigInt(Date.now()));
      stmt.bindVarchar(3, signature);
      await stmt.run();
      stmt.destroySync();
    } catch (e) {
      logger.error("Vault Insert Error:", e);
    }

    // Detect clarification needs
    const clarifyingQuestions = await this._detectClarificationNeeds(
      quanta,
      statement_
    );
    for (const q of clarifyingQuestions) {
      this.respond(q);
    }

    const decodedMeaning = this.atomizer.decodeSequence(quanta, this.system);
    logger.wave("Ingest", this.system, quanta, this.atomizer);

    const response = `Acknowledged: "${decodedMeaning}"`;
    this.respond(response);
    return decodedMeaning;
  }

  private async _detectClarificationNeeds(
    quanta: Uint32Array,
    statement: string
  ): Promise<string[]> {
    if (!this.store) return [];
    const questions: string[] = [];
    const seen = new Set<string>();
    const isCompound = /&&|\|\||then\b|therefore\b|\|-/.test(statement);
    const scopeCounts = new Map<number, number>();
    for (let i = 0; i < quanta.length; i++) {
      const scope = this.system.scope[quanta[i]];
      scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
    }
    for (let i = 0; i < quanta.length; i++) {
      const id = quanta[i];
      if (!this.system.isAllocated(id)) continue;
      if (this.system.operatorClass[id] !== OperatorClass.None) continue;
      const label = this.atomizer.resolveScope(this.system.scope[id]) ?? "";
      if (!label || seen.has(label)) continue;
      const isPlaceholder = Language.PLACEHOLDER_RE.test(label);
      const occurrences = scopeCounts.get(this.system.scope[id]) ?? 0;
      let opNeighbors = 0;
      if (
        i > 0 &&
        this.system.operatorClass[quanta[i - 1]] !== OperatorClass.None
      )
        opNeighbors++;
      if (
        i < quanta.length - 1 &&
        this.system.operatorClass[quanta[i + 1]] !== OperatorClass.None
      )
        opNeighbors++;
      let shouldAsk = false;
      if (isPlaceholder && opNeighbors >= 1) {
        shouldAsk = true;
      } else if (isCompound && occurrences >= 2 && opNeighbors >= 1) {
        const isKnown = await this.store.connection
          .prepare("SELECT 1 FROM raw_facts WHERE fact LIKE ? LIMIT 1")
          .then(async stmt => {
            try {
              stmt.bindVarchar(1, `% ${label} %`);
              const res = await stmt.runAndReadAll();
              return res.getRows().length > 0;
            } finally {
              stmt.destroySync();
            }
          })
          .catch(() => true);
        if (!isKnown) shouldAsk = true;
      }
      if (shouldAsk) {
        seen.add(label);
        questions.push(`What is ${label}?`);
      }
    }
    return questions;
  }

  // ---- Arithmetic ---------------------------------------------------------

  /**
   * Evaluates a simple arithmetic expression using temporal coordinate
   * arithmetic. posW encodes numbers linearly: posW(n) = n * 0.1.
   *
   * Returns the result as a string, or null if the expression cannot be
   * parsed as a simple binary operation.
   */
  public computeArithmetic(expr: string): string | null {
    const norm = expr
      .replace(/\bdivided\s+by\b/gi, "/")
      .replace(/\btimes\b/gi, "*")
      .replace(/\bminus\b/gi, "-")
      .replace(/\bplus\b/gi, "+")
      .replace(/\s+/g, " ")
      .trim();

    const m = norm.match(/^(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;

    const a = parseFloat(m[1]);
    const op = m[2];
    const b = parseFloat(m[3]);

    let result: number;
    switch (op) {
      case "+":
        result = a + b;
        break;
      case "-":
        result = a - b;
        break;
      case "*":
        result = a * b;
        break;
      case "/":
        if (b === 0) return null;
        result = a / b;
        break;
      default:
        return null;
    }

    if (!Number.isFinite(result)) return null;
    return Number.isInteger(result)
      ? result.toString()
      : parseFloat(result.toFixed(6)).toString();
  }

  // ---- TRAVELER step 1: Pole ingestion ------------------------------------

  /**
   * Returns and clears the pending drift targets accumulated during the most
   * recent ingest() call.  Consumed once by Traveler.observeSettlingGradient().
   */
  public takeDriftTargets(): Map<
    number,
    readonly [number, number, number, number]
  > {
    const out = this._driftTargets;
    this._driftTargets = new Map();
    return out;
  }

  /**
   * Records embedding-derived positions as drift targets for the new
   * gradient-following pipeline (step 3).
   *
   * When POLE_INGESTION_ENABLED is true, also overrides each atom's coordinates
   * to the manifold pole (0, 0, 0, 0) plus a small jitter.  The flag stays
   * false until observeSettlingGradient() passes the step-3 A/B validation
   * criteria, keeping the existing perceive/traverse pipeline unaffected.
   *
   * Numeric literals (special posW encoding on the number line) are exempt from
   * pole displacement; they carry meaning in their coordinates.
   */
  private _poleSettle(ids: Uint32Array): void {
    const { POLE_INGESTION_ENABLED, POLE_JITTER_XYZ, POLE_JITTER_W } =
      DOPAT_CONFIG.PHYSICS;
    const sys = this.system;
    this._driftTargets.clear();
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (!sys.isAllocated(id)) continue;
      // Numeric atoms encode magnitude in posW (decayRate=0 marker).
      if (sys.decayRate[id] === 0) continue;
      this._driftTargets.set(id, [
        sys.posX[id],
        sys.posY[id],
        sys.posZ[id],
        sys.posW[id],
      ]);
      if (!POLE_INGESTION_ENABLED) continue;
      sys.posX[id] = (random() - 0.5) * 2 * POLE_JITTER_XYZ;
      sys.posY[id] = (random() - 0.5) * 2 * POLE_JITTER_XYZ;
      sys.posZ[id] = (random() - 0.5) * 2 * POLE_JITTER_XYZ;
      sys.posW[id] = Math.abs((random() - 0.5) * 2 * POLE_JITTER_W);
      sys.update(id);
    }
  }

  // ---- Private helpers ----------------------------------------------------

  private detectFeedbackPolarity(text: string): FeedbackPolarity {
    if (/^(no|incorrect|wrong|that'?s wrong|false)\b/i.test(text)) {
      return "negative";
    }
    if (/^(yes|correct|right|true)\b/i.test(text)) {
      return "positive";
    }
    return null;
  }

  /**
   * Builds the topological query form from shifted text.
   * "what is X" -> "X is", "what was X" -> "X was", etc.
   */
  private extractTopologicalQuery(
    shifted: string,
    originalQuery: string
  ): {
    topologicalQuery: string;
    attractionCenter: string;
    isArithmeticQuery: boolean;
    isOrdinalQuery: boolean;
  } {
    let topologicalQuery = shifted;
    let attractionCenter = "";
    let isArithmeticQuery = false;
    let isOrdinalQuery = false;

    const whatIsMatch = shifted.match(/what(?:'?s|\s+is)\s+(.*)/i);
    const whatWasMatch = shifted.match(/what was (.*)/i);
    const whoIsMatch = shifted.match(/who is (.*)/i);
    const whoWasMatch = shifted.match(/who was (.*)/i);

    if (whatIsMatch) {
      attractionCenter = whatIsMatch[1];
      isArithmeticQuery =
        /\d[\d\s]*([+\-*/]|plus|minus|times|divided)[\d\s]*\d/i.test(
          attractionCenter.trim()
        );
      isOrdinalQuery =
        !isArithmeticQuery &&
        /^(after|before)\s+\d+/i.test(attractionCenter.trim());
      topologicalQuery = isArithmeticQuery
        ? `${attractionCenter} equals`
        : `${attractionCenter} is`;
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
      const doc = nlp(originalQuery);
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

    return {
      topologicalQuery,
      attractionCenter,
      isArithmeticQuery,
      isOrdinalQuery,
    };
  }

  /**
   * Extract heat nodes (keywords) from text for resonance matching.
   */
  private extractHeatNodes(query: string): string[] {
    const queryDoc = nlp(query);
    const verbs = queryDoc.verbs().toInfinitive().out("array");
    const nouns = queryDoc.nouns().out("array");
    const rawWords = [...verbs, ...nouns]
      .flatMap((w: string) => w.toLowerCase().split(/[^a-z0-9]+/))
      .map((w: string) => w.trim())
      .filter((w: string) => w.length > 2);

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
    return heatNodes;
  }
}

export default Language;
