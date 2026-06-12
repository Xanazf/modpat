/**
 * Skills layer - the open-ended skill registry for the Mapper.
 *
 * A "skill" is an external behaviour the Mapper can elect to invoke when a
 * query's manifold position is attracted to a capability precept. The
 * registry is just a Map<preceptId, SkillHandler> - the Mapper's potential
 * field decides which one fires.
 */

export type SkillHandler = (
  ctx: Skills.SkillContext
) => Promise<Skills.SkillResult>;

/** Convenience factory for boot-time wiring. */
export function createSkillRegistration(
  preceptId: number,
  handler: SkillHandler
): Skills.SkillRegistration {
  return { preceptId, handler };
}
