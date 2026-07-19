/**
 * Shared abstention-aware scoring for the external-dataset baseline and the
 * paraphrase-family harness (PARITY §1: a system that answers 90% and abstains
 * on 10% is strictly better than one answering 100% with 10% confident
 * falsehoods, so abstention is scored separately, never as failure).
 *
 * The verdict mapper lives here as ONE exported function with unit cases
 * (`runScoringSelftest`) so its rules are auditable and cannot silently absorb
 * the front-end improvement being measured.
 */

export type Gold = "true" | "false" | "unknown";
export type Verdict = "affirm" | "deny" | "abstain";

export interface ScoredItem {
  gold: Gold;
  verdict: Verdict;
}

export interface FamilyScore {
  /** Balanced accuracy over the ANSWERED true/false items only. */
  balancedAccuracy: number;
  /** Fraction of items on which the engine abstained. */
  abstentionRate: number;
  /** Answered-and-wrong count - the characteristic failure must stay silence. */
  confidentFalsehoods: number;
  n: number;
}

/** Phrases that signal the engine explicitly declined or failed to commit. */
const ABSTAIN_RE =
  /^\s*$|unknown|cannot determine|no coherent|insufficient|ignored \(|unprocessable/i;
/** Phrases that signal explicit denial rather than silence. */
const DENY_RE =
  /\b(no\b|not\b|false|never|deny|denied|cannot be|isn't|aren't)/i;

/**
 * Maps a raw engine answer to a Verdict for one benchmark item.
 *
 * Rules, in order:
 *   1. Empty / hedge / "unknown" surface -> abstain.
 *   2. Explicit negative surface -> deny.
 *   3. Answer contains the expected keyword(s) -> affirm.
 *   4. A commitment that neither denies nor contains the expected keyword is
 *      an UNRELATED assertion: it neither affirms nor denies the question, so
 *      it maps to abstain - the conservative choice. (Trade-off, documented:
 *      unrelated confabulation is under-counted in `confidentFalsehoods` and
 *      slightly over-credits the gold-unknown class; the alternatives inflate
 *      balanced accuracy on the answerable classes, which is worse.)
 *
 * `questionNegated`: when the benchmark QUESTION is itself negative ("Erin is
 * not round.", gold false = Erin IS round), an engine answer of "erin is
 * round" denies the question while containing no negative surface - so a
 * non-abstain verdict is flipped.
 */
export function mapAnswerToVerdict(
  answer: string,
  expected: string,
  questionNegated = false
): Verdict {
  const a = answer.toLowerCase().trim();
  if (ABSTAIN_RE.test(a)) return "abstain";
  let v: Verdict;
  if (DENY_RE.test(a)) v = "deny";
  else if (expected && a.includes(expected.toLowerCase())) v = "affirm";
  else return "abstain"; // unrelated commitment (rule 4)
  if (questionNegated) return v === "deny" ? "affirm" : "deny";
  return v;
}

/**
 * Scores one task family. Balanced accuracy = mean of per-class recall over
 * the two answerable classes (gold true -> affirm, gold false -> deny); gold
 * unknown items are correct exactly when the verdict is abstain, and are
 * folded in as their own class when present.
 */
export function scoreFamily(items: ScoredItem[]): FamilyScore {
  const classes: Gold[] = ["true", "false", "unknown"];
  const recalls: number[] = [];
  let abstained = 0;
  let confidentFalsehoods = 0;

  for (const cls of classes) {
    const inClass = items.filter(i => i.gold === cls);
    if (inClass.length === 0) continue;
    const correctVerdict: Verdict =
      cls === "true" ? "affirm" : cls === "false" ? "deny" : "abstain";
    const hit = inClass.filter(i => i.verdict === correctVerdict).length;
    recalls.push(hit / inClass.length);
  }

  for (const i of items) {
    if (i.verdict === "abstain") abstained++;
    else {
      const correct =
        (i.gold === "true" && i.verdict === "affirm") ||
        (i.gold === "false" && i.verdict === "deny");
      if (!correct) confidentFalsehoods++;
    }
  }

  return {
    balancedAccuracy:
      recalls.length === 0
        ? 0
        : recalls.reduce((a, b) => a + b, 0) / recalls.length,
    abstentionRate: items.length === 0 ? 0 : abstained / items.length,
    confidentFalsehoods,
    n: items.length,
  };
}

/** Hard-asserted unit cases for the verdict mapper; throws on any mismatch. */
export function runScoringSelftest(): void {
  const cases: [string, string, boolean, Verdict][] = [
    ["", "mortal", false, "abstain"],
    ["unknown", "wet", false, "abstain"],
    ["I cannot determine that", "wet", false, "abstain"],
    ['Ignored (Unprocessable Input): "x"', "wet", false, "abstain"],
    ["socrates is mortal", "mortal", false, "affirm"],
    ["the ground is wet", "wet", false, "affirm"],
    ["felix is not a fish", "fish", false, "deny"],
    ["no, penguins cannot fly", "fly", false, "deny"],
    ["that is false", "odd", false, "deny"],
    ["rex barks", "bark", false, "affirm"],
    // Unrelated commitment -> abstain (rule 4)
    ["something else entirely", "mortal", false, "abstain"],
    // Negated question flips non-abstain verdicts
    ["erin is round", "round", true, "deny"],
    ["erin is not round", "round", true, "affirm"],
    ["", "round", true, "abstain"],
  ];
  for (const [answer, expected, negated, want] of cases) {
    const got = mapAnswerToVerdict(answer, expected, negated);
    if (got !== want) {
      throw new Error(
        `scoring selftest: mapAnswerToVerdict(${JSON.stringify(answer)}, ${JSON.stringify(expected)}, ${negated}) = ${got}, want ${want}`
      );
    }
  }

  const s = scoreFamily([
    { gold: "true", verdict: "affirm" },
    { gold: "true", verdict: "abstain" },
    { gold: "false", verdict: "deny" },
    { gold: "false", verdict: "affirm" },
    { gold: "unknown", verdict: "abstain" },
  ]);
  // true-recall 0.5, false-recall 0.5, unknown-recall 1 -> balanced 2/3
  if (Math.abs(s.balancedAccuracy - 2 / 3) > 1e-9)
    throw new Error(`scoring selftest: balancedAccuracy ${s.balancedAccuracy}`);
  if (s.confidentFalsehoods !== 1)
    throw new Error(
      `scoring selftest: confidentFalsehoods ${s.confidentFalsehoods}`
    );
  if (Math.abs(s.abstentionRate - 0.4) > 1e-9)
    throw new Error(`scoring selftest: abstentionRate ${s.abstentionRate}`);
}
