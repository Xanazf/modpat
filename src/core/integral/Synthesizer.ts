import System, { OperatorClass } from "./System";
import { SYNTAX_ATTRACTORS } from "@config";

/**
 * The Synthesizer is responsible for collapsing a logical Geodesic path
 * into structured TypeScript code. It relies on the topological order
 * provided by the Mapper and performs minimal syntactic cleanup.
 */
export default class Synthesizer {
  private atomizer: Atomic.Engine;

  /**
   * Initializes the Synthesizer.
   *
   * @param atomizer The semantic atomizer for decoding tokens.
   */
  constructor(atomizer: Atomic.Engine) {
    this.atomizer = atomizer;
  }

  /**
   * Collapses a sequence of quantum IDs into a TypeScript string.
   */
  public collapse(pathIds: Uint32Array, system: System): string {
    if (pathIds.length === 0) return "";

    const tokens: string[] = [];
    const seenIds = new Set<number>();

    for (let i = 0; i < pathIds.length; i++) {
      const id = pathIds[i];
      const opClass = system.operatorClass[id];
      const rawToken = this.atomizer
        .decodeSequence(new Uint32Array([id]), system)
        .trim();
      const token = rawToken.toLowerCase();

      // Skip meta-targets
      if (
        token === "executable_code" ||
        token === "implies" ||
        token === "goal"
      )
        continue;

      // De-duplicate: only emit a unique particle once
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      if (opClass === OperatorClass.SyntaxAnchor) {
        if (
          ["+", "-", "*", "/", "=", ":", ",", "(", ")", "{", "}", ";"].includes(
            token
          )
        ) {
          tokens.push(token);
        } else {
          tokens.push(" " + token + " ");
        }
      } else {
        const identifier = this.sanitizeIdentifier(rawToken);
        tokens.push(" " + identifier + " ");
      }
    }

    const result = tokens.join("").trim();
    return this.postProcess(result);
  }

  /**
   * Ensures tokens are valid TypeScript identifiers.
   */
  private sanitizeIdentifier(text: string): string {
    return text
      .split(/\s+/)
      .map((word, index) => {
        if (index === 0) return word.toLowerCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join("")
      .replace(/[^a-zA-Z0-9_]/g, "");
  }

  /**
   * Final pass to clean up whitespace and ensure strict TS formatting.
   */
  private postProcess(code: string): string {
    let result = code
      .replace(/\s+\(/g, "(")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s+:/g, ":")
      .replace(/:\s+/g, ":")
      .replace(/\s+,\s+/g, ", ")
      .replace(/\s+\+/g, " +")
      .replace(/\+\s+/g, "+ ")
      .replace(/\s+\{/g, " {")
      .replace(/\{\s+/g, "{")
      .replace(/\s+\}/g, "}")
      .replace(/\s+/g, " ")
      .trim();

    // Balance fundamental structures
    let openParens = (result.match(/\(/g) || []).length;
    let closeParens = (result.match(/\)/g) || []).length;
    while (openParens > closeParens) {
      result += ")";
      closeParens++;
    }

    let openBraces = (result.match(/\{/g) || []).length;
    let closeBraces = (result.match(/\}/g) || []).length;
    while (openBraces > closeBraces) {
      result += " }";
      closeBraces++;
    }

    return result.replace(/\s+/g, " ").replace(/\s+}/g, "}").trim();
  }
}
