import nlp from "compromise";
import { parse, walk, generate } from "abstract-syntax-tree";
import { SlotType, SystemRef } from "@core_i/System";
import type Store from "@core_s/Memory";
import logger from "@utils/SpectralLogger";

/** Maps JS/TS binary operator symbols to semantic intent words. */
const OPERATOR_INTENT: Record<string, string> = {
  "+": "addition",
  "-": "subtraction",
  "*": "multiplication",
  "/": "division",
  "%": "modulo",
  "**": "power",
  "===": "equality",
  "!==": "inequality",
  "==": "equality",
  "!=": "inequality",
  ">": "greater than",
  "<": "less than",
  ">=": "greater or equal",
  "<=": "less or equal",
  "&&": "logical and",
  "||": "logical or",
  "??": "nullish coalescing",
};

function deriveIntent(node: any): string {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression": {
      const name = node.id?.name ?? "anonymous";
      const friendlyName = nlp(name.replace(/([A-Z])/g, " $1").trim())
        .normalize()
        .out("text");
      const ops: string[] = [];
      walk(node, (n: any) => {
        if (n.type === "BinaryExpression" && OPERATOR_INTENT[n.operator]) {
          ops.push(OPERATOR_INTENT[n.operator]);
        }
      });
      const opPhrase = [...new Set(ops)].join(" ");
      return `${opPhrase ? opPhrase + " " : ""}function ${friendlyName}`.trim();
    }
    case "ArrowFunctionExpression": {
      const ops: string[] = [];
      walk(node, (n: any) => {
        if (n.type === "BinaryExpression" && OPERATOR_INTENT[n.operator]) {
          ops.push(OPERATOR_INTENT[n.operator]);
        }
      });
      return (
        `${[...new Set(ops)].join(" ")} arrow function`.trim() ||
        "arrow function"
      );
    }
    case "BinaryExpression":
      return OPERATOR_INTENT[node.operator] ?? `binary ${node.operator}`;
    case "IfStatement":
      return "conditional branch";
    case "ReturnStatement":
      return "return value";
    case "VariableDeclaration":
      return `${node.kind} assignment`;
    case "CallExpression": {
      const callee = node.callee?.name ?? node.callee?.property?.name ?? "call";
      return `call ${nlp(callee.replace(/([A-Z])/g, " $1").trim())
        .normalize()
        .out("text")}`.trim();
    }
    default:
      return node.type
        .toLowerCase()
        .replace(/([A-Z])/g, " $1")
        .trim();
  }
}

function extractPatternFromNode(node: any): {
  pattern: string;
  slotTypes: Map<number, SlotType>;
  varNames: string[];
} | null {
  const nameToVar = new Map<string, number>();
  const slotTypes = new Map<number, SlotType>();
  const varNames: string[] = [];
  let nextVar = 0;

  function register(name: string, st: SlotType): void {
    if (!name || typeof name !== "string") return;
    if (!nameToVar.has(name)) {
      nameToVar.set(name, nextVar);
      slotTypes.set(nextVar, st);
      varNames.push(name);
      nextVar++;
    }
  }

  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  ) {
    if (node.id?.name) register(node.id.name, SlotType.Leaf);
    for (const p of node.params ?? [])
      if (p.name) register(p.name, SlotType.Parameter);
  } else if (node.type === "ArrowFunctionExpression") {
    for (const p of node.params ?? [])
      if (p.name) register(p.name, SlotType.Parameter);
  } else if (node.type === "VariableDeclaration") {
    for (const d of node.declarations ?? [])
      if (d.id?.name) register(d.id.name, SlotType.Leaf);
  } else if (node.type === "IfStatement") {
    if (node.test) {
      walk(
        {
          type: "Program",
          body: [{ type: "ExpressionStatement", expression: node.test }],
          sourceType: "module",
        },
        (n: any) => {
          if (n.type === "Identifier") register(n.name, SlotType.Condition);
        }
      );
    }
  }

  walk(
    {
      type: "Program",
      body: [
        node.type.includes("Expression") || node.type === "ReturnStatement"
          ? { type: "ExpressionStatement", expression: node }
          : node,
      ],
      sourceType: "module",
    },
    (n: any) => {
      if (n.type === "Identifier" && !nameToVar.has(n.name))
        register(n.name, SlotType.Leaf);
    }
  );

  if (nameToVar.size === 0) return null;

  const wrapper = {
    type: "Program",
    body: [
      node.type.includes("Expression") || node.type === "ReturnStatement"
        ? { type: "ExpressionStatement", expression: node }
        : node,
    ],
    sourceType: "module",
  };

  let pattern: string;
  try {
    pattern = generate(wrapper).trim().replace(/;\s*$/, "").trim();
  } catch {
    return null;
  }

  const sorted = [...nameToVar.entries()].sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [name, varId] of sorted) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = pattern.replace(new RegExp(`\\b${safe}\\b`, "g"), `VAR_${varId}`);
  }

  if (!pattern) return null;
  return { pattern, slotTypes, varNames };
}

/**
 * Handles code ingestion: parses TypeScript/JavaScript source, extracts abstract
 * patterns from the AST, and crystallizes (intent → pattern) into the vault.
 */
class Coder {
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  private atomizer: Atomic.Engine;
  private store: Store;

  private _respond: (msg: string) => void;

  constructor(
    systemRef: SystemRef,
    atomizer: Atomic.Engine,
    store: Store,
    respond?: (msg: string) => void
  ) {
    this.systemRef = systemRef;
    this.atomizer = atomizer;
    this.store = store;
    this._respond = respond ?? (msg => logger.log(`[LiveInference]: ${msg}`));
  }

  public async processCode(source: string): Promise<string> {
    await this.store.waitForInit();

    let ast: any;
    try {
      ast = parse(source, { module: false });
    } catch (e: any) {
      return `[processCode] Parse error: ${e.message}`;
    }

    const VISITED_TYPES = new Set([
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunctionExpression",
      "BinaryExpression",
      "IfStatement",
      "ReturnStatement",
      "VariableDeclaration",
      "CallExpression",
    ]);

    const collected: {
      intentPhrase: string;
      extracted: NonNullable<ReturnType<typeof extractPatternFromNode>>;
    }[] = [];
    const seen = new Set<string>();

    walk(ast, (node: any) => {
      if (!VISITED_TYPES.has(node.type)) return;
      const extracted = extractPatternFromNode(node);
      if (!extracted) return;
      const intentPhrase = deriveIntent(node);
      const dedupeKey = `${intentPhrase}::${extracted.pattern}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      collected.push({ intentPhrase, extracted });
    });

    let count = 0;
    for (const { intentPhrase, extracted } of collected) {
      try {
        const intentQuanta = this.atomizer.ingestSequence(
          intentPhrase,
          this.system
        );
        const patternQuanta = this.atomizer.ingestPattern(
          extracted.pattern,
          extracted.slotTypes,
          this.system
        );
        const slotFlags = this.store.packSlotFlags(extracted.slotTypes);
        await this.store.crystallizeProof(
          intentQuanta,
          patternQuanta,
          1.0,
          slotFlags
        );
        count++;
        logger.debug(
          `[processCode] +pattern: "${intentPhrase}" → "${extracted.pattern}"`
        );
      } catch (e: any) {
        logger.error("[processCode] Failed to crystallize pattern:", e.message);
      }
    }

    const summary = `Ingested ${count} code patterns.`;
    this.respond(summary);
    return summary;
  }

  private respond(response: string): void {
    this._respond(response);
  }
}

export default Coder;
