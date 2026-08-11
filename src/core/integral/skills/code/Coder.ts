/**
 * Code-synthesis skill registration.
 *
 * Returns a SkillRegistration that, when elected by the Mapper, runs the
 * code-ingestion pipeline (was Coder.processCode).
 */

import { SlotType } from "@core_i/helpers/enums";
import type Store from "@core_s/Memory";
import logger from "@utils/SpectralLogger";
import { type AstNode, generate, parse, walk } from "abstract-syntax-tree";
import nlp from "compromise";
import type { SkillHandler } from "../index";

// Synthesizer

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
  public compose(patterns: Code.CodePattern[]): string {
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
    let match = varPattern.exec(outer);
    while (match !== null) {
      const st = this.slotTypeFor(parseInt(match[1], 10), slotFlags);
      if (st & SlotType.Body || st & SlotType.Condition) {
        const escaped = match[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return outer.replace(new RegExp(escaped, "g"), inner);
      }
      match = varPattern.exec(outer);
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

// Emission (the inverse of ingestion)

/**
 * Inverse of `BaseAtomizer`'s ARITHMETIC_CANONICAL map.
 *
 * Ingestion normalizes `+` to `plus` so that "1 + 1" and "1 plus 1" produce
 * identical scope sequences - correct for arithmetic language, and destructive
 * for source text, which comes back as `return _ plus _ ;`.
 *
 * Inverting it is unambiguous **in an abstracted pattern specifically**, which
 * is the only place this runs: `extractPatternFromNode` has already replaced
 * every identifier - including member names like `.push` - with `VAR_N`, so a
 * surviving bare word is a keyword or an operator word, never a variable that
 * happened to be called `plus`.
 */
const OPERATOR_WORD_TO_SYMBOL: Record<string, string> = {
  plus: "+",
  minus: "-",
  times: "*",
  divided: "/",
  equals: "=",
};

/**
 * Turns a decoded pattern back into real source.
 *
 * Three losses happen on the way into the manifold, and exactly one of them is
 * irreversible without help:
 *
 *  1. **Spacing** - `decodeSequence` joins tokens with " ", giving
 *     `function var_0 ( var_1 , var_2 ) { ... }`. This needs no repair at all:
 *     JavaScript is whitespace-insensitive, so the spaced form already parses,
 *     and `generate` re-prints it canonically.
 *  2. **Operator words** - inverted by the map above.
 *  3. **Case** - the atomizer lowercases, so `toUpperCase` decodes as
 *     `touppercase` and CANNOT be mechanically restored. This is why
 *     `varNames` is persisted at crystallization: every identifier is a `VAR_N`
 *     slot, so restoring the slots restores the only case-bearing tokens.
 *
 * Returns null when the result does not parse - the caller treats that as an
 * abstention, so a lossy recall degrades to silence rather than to a confident
 * falsehood (PARITY §1).
 */
export function detokenizeCode(
  text: string,
  bindings: Map<number, string> = new Map()
): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "unknown") return null;

  const restored = trimmed
    .split(/\s+/)
    .map(tok => OPERATOR_WORD_TO_SYMBOL[tok.toLowerCase()] ?? tok)
    .join(" ")
    // Slots decode lowercased (`VAR_0` -> `var_0`), so match case-insensitively
    // and substitute the stored name; an unbound slot stays a legal identifier
    // rather than becoming `_`, so the parse below judges the STRUCTURE.
    .replace(
      /\bvar_(\d+)\b/gi,
      (_m, id: string) => bindings.get(Number(id)) ?? `var_${id}`
    );

  // The parse is both the repair and the verdict: anything that survives it is
  // a program, and `generate` returns it in canonical form.
  try {
    return generate(parse(restored, { module: false })).trim();
  } catch {
    // Not a standalone program - but a BODY FRAGMENT is legitimate synthesis
    // output (a ReturnStatement or BinaryExpression node crystallizes as
    // `return VAR_0 + VAR_1`, which is a syntax error at top level because
    // `return` is outside a function). Re-try it in the position it would
    // actually occupy, then hand back the body rather than the scaffold.
    try {
      const wrapped = parse(`function __emit__() {\n${restored}\n}`, {
        module: false,
      }) as { body?: { body?: { body?: AstNode[] } }[] };
      const stmts = wrapped.body?.[0]?.body?.body;
      if (!stmts || stmts.length === 0) return null;
      return generate({
        type: "Program",
        body: stmts,
        sourceType: "module",
      }).trim();
    } catch {
      return null;
    }
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

/**
 * The intent phrase a node is crystallized under. Exported so a benchmark can
 * ask for a pattern by the phrase ingestion ACTUALLY minted, rather than by a
 * hand-guessed paraphrase - otherwise a channel probe silently measures intent
 * guessing instead of the channel (tests/benchmarks/code_benchmark.ts).
 */
export function deriveIntent(node: AstNode): string {
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
      walk(node, (n: AstNode) => {
        if (n.type === "BinaryExpression" && n.operator) {
          const intent = OPERATOR_INTENT[n.operator];
          if (intent) ops.push(intent);
        }
      });
      return (
        `${[...new Set(ops)].join(" ")} arrow function`.trim() ||
        "arrow function"
      );
    }
    case "BinaryExpression":
      return node.operator
        ? (OPERATOR_INTENT[node.operator] ?? `binary ${node.operator}`)
        : "binary expression";
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

function extractPatternFromNode(node: AstNode): {
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
        (n: AstNode) => {
          if (n.type === "Identifier" && n.name)
            register(n.name, SlotType.Condition);
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
    (n: AstNode) => {
      if (n.type === "Identifier" && n.name && !nameToVar.has(n.name))
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
        const first = innerAst.body?.[0];
        if (!first) return "[processCode] Empty RHS for |-";
        const node =
          first.type === "ExpressionStatement"
            ? (first.expression ?? first)
            : first;
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
            slotFlags,
            "",
            extracted.varNames
          );
          const msg = `Manual pattern ingested: "${lhs}" → "${extracted.pattern}"`;
          respond(msg);
          return msg;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return `[processCode] Parse error in RHS: ${msg}`;
      }
    }
    return "[processCode] Missing RHS for |-";
  }

  let ast: AstNode;
  try {
    ast = parse(source, { module: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[processCode] Parse error: ${msg}`;
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

  walk(ast, (node: AstNode) => {
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
      await store.crystallizeProof(
        intentQuanta,
        patternQuanta,
        1.0,
        slotFlags,
        "",
        extracted.varNames
      );
      count++;
      logger.debug(
        `[processCode] +pattern: "${intentPhrase}" → "${extracted.pattern}"`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[processCode] Failed to crystallize pattern:", msg);
    }
  }

  const summary = `Ingested ${count} code patterns.`;
  respond(summary);
  return summary;
}

export function createCoderSkill(
  _atomizer: Atomic.Engine,
  store: Store,
  preceptId: number
): Skills.SkillRegistration {
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
