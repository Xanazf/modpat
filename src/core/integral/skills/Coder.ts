/**
 * Code-synthesis skill registration.
 *
 * Returns a SkillRegistration that, when elected by the Mapper, runs the
 * code-ingestion pipeline (was Coder.processCode).
 */

import type Store from "@core_s/Memory";
import { processCode } from "../Coder";
import type { SkillHandler, SkillRegistration } from "./index";

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
