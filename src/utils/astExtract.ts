/**
 * astExtract - TypeScript/JavaScript source → manifold triple extraction.
 *
 * Pure function: no I/O, no DB writes, no manifold mutations.
 *
 * Two-stage strategy:
 *
 *   Stage A - TypeScript compiler API (ts.createSourceFile):
 *     Extracts type-specific constructs that require TSC:
 *     interfaces, type aliases, typed parameters, return-type annotations,
 *     property type annotations, class heritage.
 *
 *   Stage B - abstract-syntax-tree (walk / find):
 *     Works on JS-compatible ESTree after TypeScript transpiles away types.
 *     Used for import declarations and call-site extraction - these are
 *     pure structural facts that work equally on .js and .ts files.
 *
 * Together they produce AstTriple[] that AstSeedWorker crystallizes.
 */

import { walk, find } from "abstract-syntax-tree";
import ts from "typescript";

export interface AstTriple {
  subject: string;
  predicate: string;
  object: string;
  /** Pre-joined `${subject} ${predicate} ${object}`. */
  text: string;
  /** Crystallization energy. Higher = more structurally stable. */
  energy: number;
  /**
   * posY hint (Kind axis):
   *   0.0 = type / interface
   *   0.1 = class
   *   0.3 = function / method
   *   0.6 = variable
   *   0.8 = enum
   *   0.9 = module / import
   */
  kindY: number;
  /** posZ hint: call depth from module top-level. */
  callDepth: number;
}

export interface AstExtractOptions {
  callDepthLimit?: number;
  includeCallSites?: boolean;
}

//  helpers

function norm(s: string): string {
  return s.replace(/\s+/g, " ").toLowerCase().trim();
}

function safeId(s: string): string {
  return norm(s.replace(/[^a-zA-Z0-9_$.]/g, " "));
}

function typeText(node: ts.TypeNode | undefined, sf: ts.SourceFile): string {
  if (!node) return "";
  return norm(node.getText(sf));
}

//  Stage A - TypeScript compiler API

function extractViaTypeScript(
  sourceText: string,
  filePath: string,
  opts: Required<AstExtractOptions>,
  seen: Set<string>,
  out: AstTriple[]
): void {
  function push(
    subject: string,
    predicate: string,
    object: string,
    energy: number,
    kindY: number,
    callDepth = 0
  ): void {
    const s = safeId(subject);
    const p = norm(predicate);
    const o = safeId(object);
    if (!s || !p || !o || s === o) return;
    const text = `${s} ${p} ${o}`;
    if (seen.has(text)) return;
    seen.add(text);
    out.push({
      subject: s,
      predicate: p,
      object: o,
      text,
      energy,
      kindY,
      callDepth,
    });
  }

  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  const fnStack: string[] = [];

  function visitFnBody(
    body: ts.Node | undefined,
    fnName: string,
    depth: number
  ): void {
    if (!body || !opts.includeCallSites || depth > opts.callDepthLimit) return;
    ts.forEachChild(body, function walkBody(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        let callee = "";
        if (ts.isIdentifier(node.expression)) {
          callee = safeId(node.expression.text);
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          callee = safeId(node.expression.name.text);
        }
        if (callee && callee !== fnName) {
          push(fnName, "calls", callee, 0.8, 0.3, depth);
        }
      }
      ts.forEachChild(node, walkBody);
    });
  }

  function handleFn(
    name: string,
    params: ts.NodeArray<ts.ParameterDeclaration>,
    retType: ts.TypeNode | undefined,
    body: ts.Node | undefined,
    depth = 0
  ): void {
    for (const p of params) {
      const t = typeText(p.type, sf);
      if (t && t !== "any") push(name, "accepts", t, 1.2, 0.3, depth);
    }
    const ret = typeText(retType, sf);
    if (ret && ret !== "void" && ret !== "any")
      push(name, "returns", ret, 1.2, 0.3, depth);
    visitFnBody(body, name, depth + 1);
  }

  function visit(node: ts.Node): void {
    // Class
    if (ts.isClassDeclaration(node) && node.name) {
      const cls = safeId(node.name.text);
      for (const h of node.heritageClauses ?? []) {
        for (const t of h.types) {
          const base = safeId(t.expression.getText(sf));
          if (h.token === ts.SyntaxKind.ExtendsKeyword)
            push(cls, "extends", base, 1.5, 0.1);
          else push(cls, "implements", base, 1.5, 0.1);
        }
      }
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          const mname = safeId(member.name.text);
          push(cls, "has", mname, 1.0, 0.1);
          handleFn(
            `${cls}.${mname}`,
            member.parameters,
            member.type,
            member.body
          );
        }
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
          const prop = safeId(member.name.text);
          const t = typeText(member.type, sf);
          if (t && t !== "any") {
            push(cls, "has", prop, 1.0, 0.1);
            push(prop, "is", t, 1.0, 0.6);
          }
        }
      }
    }

    // Interface
    else if (ts.isInterfaceDeclaration(node)) {
      const iface = safeId(node.name.text);
      for (const h of node.heritageClauses ?? []) {
        for (const t of h.types) {
          push(iface, "extends", safeId(t.expression.getText(sf)), 1.5, 0.0);
        }
      }
      for (const member of node.members) {
        if (
          (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
          ts.isIdentifier(member.name)
        ) {
          const prop = safeId(member.name.text);
          const t = typeText((member as any).type, sf);
          push(iface, "has", prop, 1.0, 0.0);
          if (t && t !== "any") push(prop, "is", t, 1.0, 0.6);
        }
      }
    }

    // Function declaration
    else if (ts.isFunctionDeclaration(node) && node.name) {
      handleFn(safeId(node.name.text), node.parameters, node.type, node.body);
    }

    // Variable with type annotation or arrow/fn initialiser
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = safeId(node.name.text);
      const t = typeText(node.type, sf);
      if (t && t !== "any") push(name, "is", t, 1.0, 0.6);
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        handleFn(name, init.parameters, init.type, init.body);
      }
    }

    // Type alias
    else if (ts.isTypeAliasDeclaration(node)) {
      const name = safeId(node.name.text);
      if (ts.isUnionTypeNode(node.type)) {
        for (const m of node.type.types) {
          const t = typeText(m, sf);
          if (t) push(name, "is", t, 1.0, 0.0);
        }
      } else if (ts.isIntersectionTypeNode(node.type)) {
        for (const m of node.type.types) {
          const t = typeText(m, sf);
          if (t) push(name, "extends", t, 1.0, 0.0);
        }
      } else {
        const t = typeText(node.type, sf);
        if (t) push(name, "is", t, 1.0, 0.0);
      }
    }

    // Enum
    else if (ts.isEnumDeclaration(node)) {
      const name = safeId(node.name.text);
      for (const member of node.members) {
        if (ts.isIdentifier(member.name)) {
          push(name, "has", safeId(member.name.text), 1.0, 0.8);
        }
      }
    }

    // Import declarations - extracted here so transpilation can't elide them.
    else if (ts.isImportDeclaration(node)) {
      const modSpec = node.moduleSpecifier;
      if (ts.isStringLiteral(modSpec)) {
        const mod = safeId(modSpec.text);
        const clause = node.importClause;
        if (clause) {
          // Default import: import path from "path"
          if (clause.name) {
            push(mod, "exports", safeId(clause.name.text), 1.0, 0.9);
          }
          // Named imports: import { A, B } from "mod"
          const nb = clause.namedBindings;
          if (nb && ts.isNamedImports(nb)) {
            for (const el of nb.elements) {
              push(mod, "exports", safeId(el.name.text), 1.0, 0.9);
            }
          }
          // Namespace import: import * as ns from "mod"
          if (nb && ts.isNamespaceImport(nb)) {
            push(mod, "exports", safeId(nb.name.text), 1.0, 0.9);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
}

//  Stage B - abstract-syntax-tree (ESTree walk)
// Used for call-site extraction only (imports are handled in Stage A to avoid
// TypeScript's import-elision on transpilation).
// Works on JS produced by ts.transpileModule() - no TS-specific syntax.

function extractViaEsTree(
  sourceText: string,
  opts: Required<AstExtractOptions>,
  seen: Set<string>,
  out: AstTriple[]
): void {
  // Strip TypeScript types so meriyah (inside abstract-syntax-tree) can parse.
  const jsSource = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
  }).outputText;

  let tree: any;
  try {
    // abstract-syntax-tree's parse() is CommonJS-imported; use dynamic require
    // to avoid module-format conflicts with tsx's ESM runner.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ast = require("abstract-syntax-tree");
    tree = (ast.parse ?? ast.default?.parse)(jsSource, { module: true });
  } catch {
    return; // Non-fatal; Stage A already handled type-bearing constructs.
  }

  function push(
    subject: string,
    predicate: string,
    object: string,
    energy: number,
    kindY: number,
    callDepth = 0
  ): void {
    const s = norm(subject);
    const p = norm(predicate);
    const o = norm(object);
    if (!s || !p || !o || s === o) return;
    const text = `${s} ${p} ${o}`;
    if (seen.has(text)) return;
    seen.add(text);
    out.push({
      subject: s,
      predicate: p,
      object: o,
      text,
      energy,
      kindY,
      callDepth,
    });
  }

  if (!tree) return;

  // Call sites: for each top-level function, find calls inside its body.
  // abstract-syntax-tree's walk() is a single-callback visitor (no enter/leave),
  // so we use find() per function body to avoid losing depth context.
  if (opts.includeCallSites) {
    const fnNodes: Array<{ name: string; node: any }> = [];

    // Collect named top-level functions
    walk(tree, (node: any) => {
      if (node.type === "FunctionDeclaration" && node.id?.name) {
        fnNodes.push({ name: norm(node.id.name), node });
      }
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        (node.init?.type === "ArrowFunctionExpression" ||
          node.init?.type === "FunctionExpression")
      ) {
        fnNodes.push({ name: norm(node.id.name), node: node.init });
      }
    });

    for (const { name: caller, node: fnNode } of fnNodes) {
      const calls = find(fnNode, "CallExpression");
      for (const call of calls) {
        let callee = "";
        if (call.callee?.type === "Identifier") callee = norm(call.callee.name);
        else if (call.callee?.type === "MemberExpression")
          callee = norm(call.callee.property?.name ?? "");
        if (callee && callee !== caller) {
          push(caller, "calls", callee, 0.8, 0.3, 1);
        }
      }
    }
  }
}

//  Public API

/**
 * Extract AstTriple records from TypeScript or JavaScript source text.
 *
 * Runs Stage A (TypeScript compiler API) for typed constructs, then
 * Stage B (abstract-syntax-tree walk) for import + call-site extraction.
 * Results are deduplicated across both stages.
 */
export function extractAstTriples(
  sourceText: string,
  filePath: string,
  opts: AstExtractOptions = {}
): AstTriple[] {
  const resolvedOpts: Required<AstExtractOptions> = {
    callDepthLimit: opts.callDepthLimit ?? 5,
    includeCallSites: opts.includeCallSites ?? true,
  };
  const seen = new Set<string>();
  const out: AstTriple[] = [];

  extractViaTypeScript(sourceText, filePath, resolvedOpts, seen, out);
  extractViaEsTree(sourceText, resolvedOpts, seen, out);

  return out;
}
