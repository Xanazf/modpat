import { SlotType } from "./System";

/**
 * A retrieved code pattern ready for composition.
 */
export interface CodePattern {
  /** Abstract pattern string, e.g. "function VAR_0(VAR_1) { VAR_BODY }" */
  template: string;
  /** Packed slot-type bitmap from wave_forms.slot_flags */
  slotFlags: bigint;
}

/**
 * The Synthesizer collapses a set of retrieved code patterns into a single
 * concrete code string.
 *
 * Two operations:
 *  - compose(): nest patterns from outer→inner by filling continuation slots
 *  - instantiate(): bind concrete names into the composed template
 */
export default class Synthesizer {
  private readonly BITS_PER_VAR = 5;
  private readonly SLOT_MASK = 0x1fn;

  /**
   * Reads the SlotType for VAR_N from a packed slot_flags BigInt.
   */
  public slotTypeFor(varId: number, slotFlags: bigint): SlotType {
    return Number(
      (slotFlags >> BigInt(varId * this.BITS_PER_VAR)) & this.SLOT_MASK
    ) as SlotType;
  }

  /**
   * Composes an ordered list of patterns (outer → inner) into a single template
   * by filling each outer pattern's first Body/Condition VAR slot with the next
   * pattern's template, recursively.
   *
   * Patterns should be sorted from highest posZ (outermost structure, e.g. function)
   * to lowest posZ (innermost expression, e.g. addition).
   */
  public compose(patterns: CodePattern[]): string {
    if (patterns.length === 0) return "";
    if (patterns.length === 1) return patterns[0].template;

    let accumulated = patterns[0].template;
    const { slotFlags } = patterns[0];

    for (let p = 1; p < patterns.length; p++) {
      const inner = patterns[p].template;
      accumulated = this.fillFirstContinuationSlot(
        accumulated,
        slotFlags,
        inner
      );
    }

    return accumulated;
  }

  /**
   * Finds the first VAR_N in the template whose SlotType has the Body or
   * Condition bit set, and replaces it with the provided inner template.
   * If no continuation slot is found, appends to the last open block.
   */
  private fillFirstContinuationSlot(
    outer: string,
    slotFlags: bigint,
    inner: string
  ): string {
    // Find all VAR_N tokens and test each for Body|Condition bits.
    const varPattern = /VAR_(\d+)/g;
    let match: RegExpExecArray | null;

    while ((match = varPattern.exec(outer)) !== null) {
      const varId = parseInt(match[1], 10);
      const st = this.slotTypeFor(varId, slotFlags);
      if (st & SlotType.Body || st & SlotType.Condition) {
        return (
          outer.slice(0, match.index) +
          inner +
          outer.slice(match.index + match[0].length)
        );
      }
    }

    // No continuation slot found, append inner before the last closing brace.
    const lastBrace = outer.lastIndexOf("}");
    if (lastBrace !== -1) {
      return outer.slice(0, lastBrace) + inner + outer.slice(lastBrace);
    }

    return `${outer} ${inner}`;
  }

  /**
   * Replaces all remaining VAR_N placeholders in a composed template with
   * their concrete bound values.  Unbound VARs become "_".
   */
  public instantiate(
    template: string,
    varBindings: Map<number, string>
  ): string {
    return template.replace(
      /VAR_(\d+)/g,
      (_, id) => varBindings.get(+id) ?? "_"
    );
  }

  /**
   * Builds a varBindings map from a decoded sequence of concrete tokens.
   * Tokens are bound to VARs in order of first appearance (matching the
   * abstractSequence VAR assignment order used during ingestion).
   */
  public buildBindings(
    tokens: string[],
    slotFlags: bigint
  ): Map<number, string> {
    const bindings = new Map<number, string>();
    let nextVar = 0;

    for (const token of tokens) {
      if (!token || token === "unknown") continue;
      // Only bind Leaf/Parameter slots, Body/Condition slots are filled by compose().
      const st = this.slotTypeFor(nextVar, slotFlags);
      if (!(st & SlotType.Body) && !(st & SlotType.Condition)) {
        bindings.set(nextVar, token);
      }
      nextVar++;
    }

    return bindings;
  }
}
