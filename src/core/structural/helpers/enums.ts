export enum EdgeKind {
  /** Structural nesting: module->symbol, class->member, parent term->subterm. */
  Containment = 0,
  /** Use / dependency: call, import, type annotation, premise->rule. */
  Reference = 1,
  /** Equivalence / rewrite: equality, modus ponens, arithmetic evaluation. */
  Reduction = 2,
}

/**
 * Canonical node kinds. The numeric companion (kindToY) is the posY (Kind-axis)
 * coordinate, chosen to match astExtract's existing kindY scheme so code, logic,
 * and math stratify on the same axis.
 */
export enum NodeKind {
  Type = 0,
  Class = 1,
  Function = 2,
  Variable = 3,
  Enum = 4,
  Module = 5,
  Literal = 6,
  Operator = 7,
  Term = 8,
}
