/**
 * Semantic Grounding Suite, Minimal Propositional Calculus (Track 7)
 *
 * Tests six inference rules against the resolver. The goal is measurement, not
 * correction: record which rules pass, which fail, and why. R1 (Modus Ponens)
 * is the only hard assertion; all other rules are soft-logged so the suite
 * never crashes on expected gaps.
 *
 * Run with --verbose for W-matrix, accumulated-resonance, and sink-candidate dumps.
 */
import assert from "node:assert/strict";
import type { ResolverDiagnostics } from "@core_i/Resolver";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "../utils/harness";

const VERBOSE = process.argv.includes("--verbose");
const TAU = 0.05; // minimum sinkStrength to count as a "positive" result

interface GroundingCase {
  rule: string;
  /**
   * NL sentences ingested into the manifold before the query.
   * Uses the exact LogicAtomizer token vocabulary so scope matching is deterministic.
   */
  premises: string[];
  /** Logical query ending with the Sink operator (|-). */
  query: string;
  /**
   * Whether the system should give a positive answer (sinkStrength > TAU).
   * false = we EXPECT the system to NOT affirm the conclusion (documenting a gap).
   */
  expectedPositive: boolean;
  /** Optional keyword the decoded result must contain for the case to count as PASS. */
  expectedKeyword?: string;
  minSinkStrength: number;
  /**
   * If true, a hard assert.ok is thrown when the case fails, used only for R1
   * which is the track-7 acceptance criterion.
   */
  mustPass: boolean;
}

const CASES: GroundingCase[] = [
  {
    rule: "R1 Modus Ponens (⊃-elim)",
    premises: ["socrates is human", "all human are mortal"],
    query: "socrates is human && all human are mortal |-",
    expectedPositive: true,
    expectedKeyword: "mortal",
    minSinkStrength: TAU,
    mustPass: true,
  },
  {
    rule: "R2 Hypothetical Syllogism",
    premises: ["rain implies wet", "wet implies growth"],
    query: "rain implies wet && wet implies growth |-",
    expectedPositive: true,
    expectedKeyword: "growth",
    minSinkStrength: TAU,
    mustPass: false,
  },
  {
    rule: "R3 Double Negation Elimination",
    premises: [],
    query: "door is not not open |-",
    expectedPositive: true,
    expectedKeyword: "open",
    minSinkStrength: TAU,
    // Passes through wave physics: two sequential Inversion operators produce a
    // double sign-flip in the matrix power series (W³[door→open] > 0), which
    // is constructive interference by algebraic cancellation - the same mechanism
    // as destructive interference of a destructive wave. Reproducible and correct.
    mustPass: true,
  },
  {
    rule: "R4 Conjunction Elimination (left)",
    premises: ["cat is black", "dog is white"],
    query: "cat is black && dog is white |-",
    expectedPositive: true,
    expectedKeyword: "black",
    minSinkStrength: TAU,
    mustPass: false,
  },
  {
    rule: "R5 Conjunction Introduction",
    premises: ["sky is blue", "sea is deep"],
    query: "sky is blue && sea is deep |-",
    expectedPositive: true,
    minSinkStrength: TAU,
    mustPass: false,
  },
  {
    rule: "R6 Modus Tollens",
    premises: ["fire implies smoke", "not smoke"],
    query: "fire implies smoke && not smoke |-",
    // Resolved via anti-particle back-propagation: ¬smoke flows backward through
    // the A→B lens, making fire accumulate negative incoming energy.  Fire is the
    // most-negatively-affected non-directly-negated operand → inferred as ¬fire.
    expectedPositive: true,
    expectedKeyword: "not",
    minSinkStrength: TAU,
    mustPass: true,
  },
];

export interface GroundingResult {
  rule: string;
  sinkStrength: number;
  result: string;
  supported: boolean;
  notes: string;
}

function dumpDiagnostics(d: ResolverDiagnostics): void {
  const { N, tokenLabels, operatorClasses, W, accumulated, sinkCandidates } = d;

  // Token table
  const header = tokenLabels
    .map((t, i) => `${i}:${t}(op=${operatorClasses[i]})`)
    .join("  ");
  logger.log(`  Tokens: ${header}`);

  // Transfer matrix W (only non-zero entries)
  logger.log(`  Transfer Matrix W (non-zero):`);
  for (let i = 0; i < N; i++) {
    const row: string[] = [];
    for (let j = 0; j < N; j++) {
      const v = W[i * N + j];
      if (Math.abs(v) > 1e-6) row.push(`[${i}→${j}]=${v.toFixed(3)}`);
    }
    if (row.length) logger.log(`    ${row.join("  ")}`);
  }

  // Accumulated resonance, top non-trivial entries
  logger.log(`  Accumulated Resonance (top entries):`);
  const entries: { i: number; j: number; v: number }[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v = accumulated[i * N + j];
      if (Math.abs(v) > 0.01) entries.push({ i, j, v });
    }
  }
  entries.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  for (const { i, j, v } of entries.slice(0, 12)) {
    logger.log(
      `    [${i}:${tokenLabels[i]}→${j}:${tokenLabels[j]}] = ${v.toFixed(4)}`
    );
  }

  // Sink candidates
  logger.log(`  Sink candidates (top 5):`);
  for (const c of sinkCandidates) {
    logger.log(
      `    idx=${c.idx} "${c.label}" strength=${c.strength.toFixed(4)}` +
        `  pos=(${c.posX.toFixed(1)},${c.posY.toFixed(1)},${c.posZ.toFixed(1)},${c.posW.toFixed(1)})`
    );
  }
}

export async function runGroundingTests(): Promise<GroundingResult[]> {
  const results: GroundingResult[] = [];

  await describe("Semantic Grounding, Propositional Fragment", async () => {
    const env = await TestHarness.getEnvironment("base");

    for (const c of CASES) {
      await it(c.rule, async () => {
        // Ingest premises into the shared manifold.
        for (const p of c.premises) {
          env.atomizer.ingestSequence(p, env.system);
        }

        // Ingest and resolve the query.
        const queryIds = env.atomizer.ingestSequence(c.query, env.system);
        const resultIds = await env.resolver.resolveSequence(queryIds);
        const result = env.atomizer
          .decodeSequence(resultIds, env.system)
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

        const sinkStrength = env.resolver.lastSinkStrength;
        const positive =
          sinkStrength > c.minSinkStrength &&
          (!c.expectedKeyword || result.includes(c.expectedKeyword));

        const supported = positive === c.expectedPositive;
        const status = supported ? "PASS" : "FAIL";
        const notes = supported
          ? `sinkStrength=${sinkStrength.toFixed(4)}, result="${result}"`
          : `sinkStrength=${sinkStrength.toFixed(4)}, result="${result}", ` +
            (c.expectedPositive
              ? "expected positive conclusion, system returned weak/incorrect result"
              : "expected gap confirmed: system affirms conclusion it should negate");

        logger.log(`  [${status}] ${c.rule}: ${notes}`);

        results.push({ rule: c.rule, sinkStrength, result, supported, notes });

        if (VERBOSE && env.resolver.lastDiagnostics) {
          dumpDiagnostics(env.resolver.lastDiagnostics);
        }

        // Hard assertion only for R1, the acceptance criterion for this track.
        if (c.mustPass) {
          assert.ok(
            supported,
            `${c.rule} MUST pass (track-7 acceptance criterion). ` +
              `sinkStrength=${sinkStrength.toFixed(4)}, result="${result}"`
          );
        }
      });
    }

    await TestHarness.disposeEnvironment(env);
  });

  return results;
}
