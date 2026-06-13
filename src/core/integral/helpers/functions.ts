import { DOPAT_CONFIG, SYNTAX_ATTRACTORS } from "@config";
import { OperatorClass } from "./enums";

/**
 * Classifies a raw string token into its corresponding OperatorClass.
 *
 * @param token The string representation of the operator.
 * @returns The classified OperatorClass.
 */
export function classifyOperatorToken(token: string): OperatorClass {
  const norm = token.trim().toLowerCase();

  // Arithmetic operators and identity binding symbols must be classified
  // before the SYNTAX_ATTRACTORS guard because "+", "-", "*", "/", "=" all
  // appear in STRUCTURES (needed for code synthesis landmark detection) and
  // would otherwise be silently promoted to SyntaxAnchor, preventing the
  // SVO split from firing on statements like "1+1=2".
  switch (norm) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "plus":
    case "minus":
    case "times":
    case "multiplied":
    case "divided":
      return OperatorClass.Arithmetic;
    case "equals":
    case "=":
      return OperatorClass.IdentityShift;
  }

  // TypeScript Physicalized Code Synthesis: check syntax attractors.
  if (
    SYNTAX_ATTRACTORS.KEYWORDS.has(norm) ||
    SYNTAX_ATTRACTORS.STRUCTURES.has(norm)
  ) {
    return OperatorClass.SyntaxAnchor;
  }

  // TODO: allow the Mapper to expand this list
  // - needs "persistent identity" check;
  //  - operators are immutable across contexts;
  //  - if new_operator != immutable { new_operator = OperatorClass.None }
  // - possibly needs human review;
  switch (norm) {
    case "implies":
    case "=>":
    case "is":
    case "am": // first-person singular present of "to be"
    case "are":
    case "was":
    case "were":
    case "can":
    case "after": // ordinal succession - encodes the number-line "next" relation
    case "before": // ordinal precedence
      return OperatorClass.IdentityShift;
    case "&&":
    case "and":
    case "but":
      return OperatorClass.Conjunction;
    case "|-":
    case "then":
    case "therefore":
      return OperatorClass.Sink;
    case "exists":
      return OperatorClass.Quantifier;
    case "all":
    case "for all":
    case "every":
    case "some":
    case "any":
      return OperatorClass.Modifier;
    case "not":
    case "!":
    case "didn't":
    case "did not":
    case "cannot":
      return OperatorClass.Inversion;
    case "do":
    case "did":
    case "born":
    case "died":
    case "invented":
    case "discovered":
      return OperatorClass.Action;
    case "how":
    case "who":
    case "what":
    case "where":
    case "when":
    case "why":
      return OperatorClass.Query;
    default:
      return OperatorClass.None;
  }
}

/**
 * A collection of mathematical operations for analyzing the logical manifold.
 */
export const LogicOperations = {
  /**
   * Calculates the inverse square of a precept's mass relative to a target distance.
   * Simulates the "gravitational" pull of a logical entity.
   *
   * @param system The logical manifold to query.
   * @param source The index of the source precept.
   * @param target The distance (or target index) to calculate against.
   * @returns The resulting attenuated logical mass.
   */
  calculateInverseSquare(
    system: Root.ManifoldView,
    source: number,
    target: number
  ): number {
    const baseMass = system.mass[source];
    // If the target is the source itself, return full mass.
    if (target === 0) return baseMass;
    // Apply physically rigorous isotropic point source flux constant (1 / 4πr²)
    return baseMass / (4 * Math.PI * target * target);
  },

  /**
   * Determines if a precept has become "supermassive," potentially creating a logical singularity.
   * Supermassive precepts attract variables with extreme force but may collapse if the scope is too small.
   *
   * @param system The logical manifold.
   * @param id The index of the precept.
   * @returns True if the precept exceeds the blackbody limit.
   */
  isSupermassive(system: Root.ManifoldView, id: number): boolean {
    return (
      system.mass[id] > DOPAT_CONFIG.BLACKBODY_LIMIT && system.scope[id] <= 1
    );
  },

  /**
   * Determines if a precept is "universal," having infinite scope and minimal individual mass.
   *
   * @param system The logical manifold.
   * @param id The index of the precept.
   * @returns True if the precept qualifies as universal.
   */
  isUniversal(system: Root.ManifoldView, id: number): boolean {
    return (
      system.mass[id] < system.epsilon && system.scope[id] > system.maxilon
    );
  },
};
