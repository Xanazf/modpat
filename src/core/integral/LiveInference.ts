import nlp from "compromise";
import { parse } from "abstract-syntax-tree";
import { DOPAT_CONFIG } from "@config";
import type Resolver from "@core_i/Resolver";
import { SystemRef } from "@core_i/System";
import type Store from "@core_s/Memory";
import logger from "@utils/SpectralLogger";
import Unfolder from "@core_s/Unfolder";
import Listener, { isCodeIntent } from "./Listener";
import Talker from "./Talker";
import Coder from "./Coder";
import { SelfTeacher } from "./SelfTeacher";
import { InquiryQueue } from "./SelfTeacher";

/**
 * AST node types that the Coder knows how to extract patterns from.
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
 * Returns true when the input looks like executable code rather than natural language.
 *
 * Two-stage check:
 *  1. Fast heuristic — must contain at least one structural code indicator.
 *     Natural language rarely uses `{`, `;`, `=>`, or starts with a JS keyword.
 *  2. AST parse attempt — if the heuristic passes, try to parse; the input is
 *     treated as code only if parsing succeeds AND produces at least one
 *     recognised Coder node type (prevents false positives like "if you want").
 */
function isCodeInput(text: string): boolean {
  // Quick reject: natural language almost never has these together.
  if (
    !/[{;]/.test(text) &&
    !/\bfunction\b|\bconst\s+\w|\blet\s+\w|\bvar\s+\w|\bclass\s+\w/.test(text)
  ) {
    return false;
  }
  try {
    const ast = parse(text, { module: false });
    return (ast as any).body.some((node: any) =>
      CODE_NODE_TYPES.has(node.type)
    );
  } catch {
    return false;
  }
}

/**
 * The LiveInference toolkit facilitates real-time topological query resolution.
 * It bridges natural language input with the logical manifold by composing three
 * specialised engines:
 *
 *  - Listener  — question processing and manifold/vault/unfolder resolution
 *  - Talker    — command ingestion and contradiction detection
 *  - Coder     — source-code pattern extraction and vault crystallisation
 *
 * LiveInference owns the routing (processIntent), feedback reinforcement, and
 * the Unfolder lifecycle.
 */
export class LiveInference {
  private systemRef: SystemRef;
  private store: Store;
  private unfolder: Unfolder;
  private listener: Listener;
  private talker: Talker;
  private coder: Coder;
  private selfTeacher: SelfTeacher;
  private inquiryQueue: InquiryQueue;

  /** Signature of the most-recently-processed question or command, used by feedback routing. */
  private last_signature: string | null = null;
  private intentCount = 0;

  constructor(
    system: Root.ManifoldView | SystemRef,
    atomizer: Atomic.Engine,
    resolver: Resolver,
    store: Store,
    unfolder?: Unfolder
  ) {
    this.systemRef =
      system instanceof SystemRef ? system : new SystemRef(system);
    this.store = store;
    this.unfolder = unfolder || new Unfolder(this.systemRef, atomizer as any);
    resolver.setUnfolder(this.unfolder);

    this.listener = new Listener(
      this.systemRef,
      atomizer,
      resolver,
      store,
      this.unfolder,
      msg => this.respond(msg)
    );
    this.talker = new Talker(this.systemRef, atomizer, store, msg =>
      this.respond(msg)
    );
    this.coder = new Coder(this.systemRef, atomizer, store, msg =>
      this.respond(msg)
    );
    this.selfTeacher = new SelfTeacher(
      this.systemRef,
      atomizer,
      resolver,
      store,
      this.unfolder
    );
    this.inquiryQueue = new InquiryQueue();
  }

  /** Exposes SelfTeacher for REPL-driven learning commands. */
  public getSelfTeacher(): SelfTeacher {
    return this.selfTeacher;
  }

  /** Exposes InquiryQueue for REPL-driven proactive reasoning. */
  public getInquiryQueue(): InquiryQueue {
    return this.inquiryQueue;
  }

  /**
   * Processes an incoming query and routes it based on inferred intent.
   * Handles yes/no feedback reinforcement before delegating to the appropriate engine.
   */
  public async processIntent(query: string): Promise<string> {
    if (++this.intentCount % 50 === 0) {
      await this.store.cullWeakWaveForms();
    }
    if (this.intentCount % 20 === 0) {
      this.selfTeacher.runCycle(5).catch(() => {});
    }
    const doc = nlp(query);
    const isQuestion = doc.questions().length > 0 || query.trim().endsWith("?");

    if (/^(no|incorrect|wrong|that'?s wrong|false)\b/i.test(query)) {
      if (this.last_signature) {
        await this.store.adjustEnergy(this.last_signature, -0.5);
        await this.store.adjustUsageCount(this.last_signature, 0);
        const response =
          "Feedback acknowledged. Structural confidence reduced.";
        this.respond(response);
        return response;
      }
    }
    if (/^(yes|correct|right|true)\b/i.test(query)) {
      if (this.last_signature) {
        await this.store.adjustEnergy(this.last_signature, 0.1);
        await this.store.adjustUsageCount(
          this.last_signature,
          DOPAT_CONFIG.memory.FEEDBACK_BOOST
        );
        const response =
          "Feedback acknowledged. Structural confidence increased.";
        this.respond(response);
        return response;
      }
    }

    if (
      isQuestion ||
      query.match(/^(what|who|where|how|why|is|are|can|do|does)\b/i) ||
      isCodeIntent(query)
    ) {
      // isCodeIntent catches synthesis requests ("write a function that…") so they
      // reach the Listener's code-synthesis path rather than the Talker.
      return this.processQuestion(query);
    } else if (isCodeInput(query)) {
      // Raw executable code pasted directly — route to Coder for pattern extraction.
      return this.processCode(query);
    } else {
      return this.processCommand(query);
    }
  }

  /** Delegates to Listener and syncs last_signature for subsequent feedback. */
  public async processQuestion(query: string): Promise<string> {
    const result = await this.listener.processQuestion(query);
    this.last_signature = this.listener.lastSignature;

    // If the system couldn't answer, queue the topic for proactive follow-up.
    if (
      !result ||
      result.trim() === "unknown" ||
      result.startsWith("[Unfolder]")
    ) {
      const topic = this.extractTopic(query);
      if (topic) this.inquiryQueue.enqueue(topic, query);
    } else {
      // The user's question might have answered a pending inquiry.
      this.inquiryQueue.checkForAnswers(query);
    }

    return result;
  }

  /** Delegates to Talker; checks whether the response resolves any open inquiry. */
  public async processCommand(statement: string): Promise<string> {
    const result = await this.talker.processCommand(statement);
    this.last_signature = this.talker.lastSignature;
    // User statements often answer inquiries ("X is Y" resolves "what is X?").
    this.inquiryQueue.checkForAnswers(statement);
    return result;
  }

  /** Delegates to Coder. */
  public async processCode(source: string): Promise<string> {
    return this.coder.processCode(source);
  }

  public respond(response: string): void {
    logger.log(`[LiveInference]: ${response}`);
  }

  /** Extracts the most content-bearing word from a query for backlog keying. */
  private extractTopic(query: string): string {
    const stop = new Set([
      "what",
      "who",
      "where",
      "when",
      "why",
      "how",
      "is",
      "am",
      "are",
      "was",
      "were",
      "a",
      "an",
      "the",
      "it",
      "its",
      "this",
      "that",
      "do",
      "does",
      "did",
      "can",
      "will",
      "would",
      "could",
      "should",
      "i",
      "me",
      "my",
      "you",
      "your",
      "we",
      "our",
    ]);
    const tokens = query
      .replace(/[?|!|-]+$/g, "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2 && !stop.has(t));
    // Longest content word is typically the most specific noun.
    return tokens.sort((a, b) => b.length - a.length)[0] ?? "";
  }
}

export default LiveInference;
