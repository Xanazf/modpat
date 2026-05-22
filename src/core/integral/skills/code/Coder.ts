/**
 * Code-synthesis skill registration.
 *
 * Returns a SkillRegistration that, when elected by the Mapper, runs the
 * code-ingestion pipeline (was Coder.processCode).
 */

import type Store from "@core_s/Memory";
import type { SkillHandler, SkillRegistration } from "../index";
import { SlotType, type SystemRef } from "@core_i/System";
import logger from "@utils/SpectralLogger";
import { generate, parse, walk } from "abstract-syntax-tree";
import nlp from "compromise";

// Synthesizer

/** A retrieved code pattern ready for composition. */
export interface CodePattern {
  /** Abstract pattern string, e.g. "function VAR_0(VAR_1) { VAR_BODY }" */
  template: string;
  /** Packed slot-type bitmap from wave_forms.slot_flags */
  slotFlags: bigint;
}

/**
 * The Synthesizer collapses a set of retrieved code patterns into a single
 * concrete code string (compose → instantiate).
 */
export class Synthesizer {
  private readonly BITS_PER_VAR = 5;
  private readonly SLOT_MASK = 0x1fn;

  public slotTypeFor(varId: number, slotFlags: bigint): SlotType {
    return Number(
      (slotFlags >> BigInt(varId * this.BITS_PER_VAR)) & this.SLOT_MASK
    ) as SlotType;
  }

  /**
   * Composes patterns (outer → inner) into a single template by filling each
   * outer pattern's first Body/Condition VAR slot with the next pattern.
   */
  public compose(patterns: CodePattern[]): string {
    if (patterns.length === 0) return "";
    if (patterns.length === 1) return patterns[0].template;
    let accumulated = patterns[0].template;
    const { slotFlags } = patterns[0];
    for (let p = 1; p < patterns.length; p++) {
      accumulated = this._fillContinuationSlots(
        accumulated,
        slotFlags,
        patterns[p].template
      );
    }
    return accumulated;
  }

  private _fillContinuationSlots(
    outer: string,
    slotFlags: bigint,
    inner: string
  ): string {
    const varPattern = /VAR_(\d+)/gi;
    let match: RegExpExecArray | null;
    while ((match = varPattern.exec(outer)) !== null) {
      const st = this.slotTypeFor(parseInt(match[1], 10), slotFlags);
      if (st & SlotType.Body || st & SlotType.Condition) {
        const escaped = match[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return outer.replace(new RegExp(escaped, "g"), inner);
      }
    }
    const lastBrace = outer.lastIndexOf("}");
    return lastBrace !== -1
      ? outer.slice(0, lastBrace) + inner + outer.slice(lastBrace)
      : `${outer} ${inner}`;
  }

  /** Replaces all VAR_N placeholders with bound values; unbound VARs become "_". */
  public instantiate(
    template: string,
    varBindings: Map<number, string>
  ): string {
    return template.replace(
      /VAR_(\d+)/gi,
      (_, id) => varBindings.get(+id) ?? "_"
    );
  }

  /** Builds a varBindings map from concrete tokens in order of appearance. */
  public buildBindings(
    tokens: string[],
    slotFlags: bigint
  ): Map<number, string> {
    const bindings = new Map<number, string>();
    let nextVar = 0;
    for (const token of tokens) {
      if (!token || token === "unknown") continue;
      const st = this.slotTypeFor(nextVar, slotFlags);
      if (!(st & SlotType.Body) && !(st & SlotType.Condition)) {
        bindings.set(nextVar, token);
      }
      nextVar++;
    }
    return bindings;
  }
}

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
      const base = `function ${friendlyName}`.trim();
      return base;
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
 * Standalone code-ingestion function (was Coder.processCode).
 * Parses TypeScript/JavaScript source, extracts abstract patterns from the
 * AST, and crystallizes (intent → pattern) into the vault.
 */
export async function processCode(
  source: string,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  store: Store,
  respond: (msg: string) => void = msg => logger.log(`[Coder]: ${msg}`)
): Promise<string> {
  await store.waitForInit();

  if (source.includes("|-")) {
    const [lhs, rhs] = source.split("|-").map(s => s.trim());
    if (rhs) {
      try {
        const innerAst = parse(rhs, { module: false });
        const node =
          innerAst.body[0]?.type === "ExpressionStatement"
            ? innerAst.body[0].expression
            : innerAst.body[0];
        const extracted = extractPatternFromNode(node);
        if (extracted) {
          const intentQuanta = atomizer.ingestSequence(lhs, system);
          const patternQuanta = atomizer.ingestPattern(
            extracted.pattern,
            extracted.slotTypes,
            system
          );
          const slotFlags = store.packSlotFlags(extracted.slotTypes);
          await store.crystallizeProof(
            intentQuanta,
            patternQuanta,
            1.0,
            slotFlags
          );
          const msg = `Manual pattern ingested: "${lhs}" → "${extracted.pattern}"`;
          respond(msg);
          return msg;
        }
      } catch (e: any) {
        return `[processCode] Parse error in RHS: ${e.message}`;
      }
    }
    return "[processCode] Missing RHS for |-";
  }

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
      const intentQuanta = atomizer.ingestSequence(intentPhrase, system);
      const patternQuanta = atomizer.ingestPattern(
        extracted.pattern,
        extracted.slotTypes,
        system
      );
      const slotFlags = store.packSlotFlags(extracted.slotTypes);
      await store.crystallizeProof(intentQuanta, patternQuanta, 1.0, slotFlags);
      count++;
      logger.debug(
        `[processCode] +pattern: "${intentPhrase}" → "${extracted.pattern}"`
      );
    } catch (e: any) {
      logger.error("[processCode] Failed to crystallize pattern:", e.message);
    }
  }

  const summary = `Ingested ${count} code patterns.`;
  respond(summary);
  return summary;
}

export function createCoderSkill(
  atomizer: Atomic.Engine,
  store: Store,
  preceptId: number
): SkillRegistration {
  const handler: SkillHandler = async ctx => {
    const answer = await processCode(
      ctx.query,
      ctx.system as Root.ManifoldView,
      ctx.atomizer,
      ctx.store ?? store,
      msg => ctx.language?.respond(msg)
    );
    return { answer, confidence: 1.0 };
  };
  return { preceptId, handler };
}
