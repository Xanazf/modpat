/**
 * Phase 4.5 - the survey loop's CODE channel, demonstrated end to end.
 *
 * The arithmetic channel proved the loop's plumbing, but its evaluator was
 * in-process arithmetic. This channel answers for the truth by EXECUTING
 * TypeScript through `tsx` - a child process that never sees a coordinate - so
 * the agreement is fidelity-to-behaviour, the first fidelity number the parser
 * cannot have smuggled in.
 *
 *   1. Ground the number line 0..10. Emit small typed functions
 *      `(): number => a OP b`; geometry predicts each reduct by composing the
 *      operands' grounded W positions. `tsx` runs the functions; predictions
 *      match execution exactly (the homomorphism is exact).
 *   2. Seed a mis-survey: "5" recorded at 5.5. Execution is UNCHANGED (the
 *      source text is untouched), but the geometry's predictions for functions
 *      touching 5 now diverge from what the program actually returns.
 *   3. The loop localizes the divergences to "5" (errors have addresses), makes
 *      one local re-placement, and behavioural-vs-executed fidelity re-validates.
 *
 * Run: tsx scripts/dev/code_survey_loop_demo.ts
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import {
  codeBehaviouralFidelity,
  codeSurveyLoop,
  executeExpressions,
} from "@core_s/grounding/CodeBehaviouralFidelity";
import { NUMBER_LINE_SCALE } from "@skill_cogi/Reduction";

const N = 11;

async function run(): Promise<void> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();

  const ids: number[] = [];
  for (let n = 0; n < N; n++) {
    const scope = atomizer.getSymbolScope(String(n), false);
    const id = system.createLocation(system.c, scope);
    system.posW[id] = n * NUMBER_LINE_SCALE;
    system.decayRate[id] = 0;
    system.update(id);
    ids.push(id);
  }

  const exprs: string[] = [];
  for (let a = 0; a <= 10; a++) {
    for (let b = 0; b <= 10; b++) {
      if (a + b <= 10) exprs.push(`${a} + ${b}`);
      if (a - b >= 0) exprs.push(`${a} - ${b}`);
    }
  }

  console.log("=== 1. faithful survey, truth from tsx execution ===");
  const actuals = executeExpressions(exprs);
  const clean = codeBehaviouralFidelity(exprs, actuals, system, atomizer);
  console.log(
    `behavioural fidelity ${clean.matched}/${clean.total} = ${clean.fidelity.toFixed(3)} ` +
      `(geometry-predicted reduct vs the value the program RETURNED)`
  );

  console.log("\n=== 2. seeded mis-survey: '5' recorded at 5.5 ===");
  system.posW[ids[5]] = 5.5 * NUMBER_LINE_SCALE;
  const broken = codeBehaviouralFidelity(exprs, actuals, system, atomizer);
  console.log(
    `behavioural fidelity: ${broken.matched}/${broken.total} = ${broken.fidelity.toFixed(3)} ` +
      `(execution is unchanged; only the geometry drifted)`
  );
  for (const d of broken.divergences.slice(0, 3)) {
    console.log(
      `  "${d.expr}" predicted=${d.predicted} executed=${d.actual} addresses=[${d.aId}, ${d.bId}]`
    );
  }

  console.log("\n=== 3. localize, repair, re-validate against execution ===");
  const loop = codeSurveyLoop(exprs, system, atomizer, { actuals });
  for (const r of loop.repairs) {
    console.log(
      `  repaired "${r.label}": posW ${r.currentW.toFixed(3)} -> ${r.suggestedW.toFixed(3)} (one local write)`
    );
  }
  console.log(
    `behavioural fidelity after: ${loop.after.matched}/${loop.after.total} = ` +
      `${loop.after.fidelity.toFixed(3)} converged=${loop.converged}`
  );
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
