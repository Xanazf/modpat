/**
 * Identity - how the system understands and expresses itself.
 *
 * Two concerns live here because they describe the same thing from different
 * angles: SelfConcept is the system's physical self-model in the manifold
 * (an immortal, super-massive precept at the origin that all geodesics curve
 * toward), and the perspective functions are the linguistic self-model
 * (transforming second-person "you" into first-person "i" so the manifold
 * processes every query from the system's own point of view).
 */

import type Store from "@core_s/Memory";
import logger from "@utils/SpectralLogger";

// SelfConcept

/**
 * SelfConcept - the ego-centre of the logical manifold.
 *
 * Creates and maintains a permanent, super-massive precept fixed at the manifold
 * origin (posX=0, posY=0, posZ=0, posW=0).  All first-person pronouns ("I", "me",
 * "my", …) are already normalised to the canonical scope of "i" by BaseAtomizer,
 * so every self-referential token constructively interferes with this precept.
 *
 * Physics consequences:
 *  - The self-precept has mass = c² × SELF_MASS_FACTOR (super-massive), giving it
 *    extreme influence in the Mapper's potential field.  All geodesics curve toward
 *    (0,0,0,0), making the manifold ego-centric: self-related reasoning has a literal
 *    gravitational centre.
 *  - decayRate = 0 - the self never fades.  It is the only precept that persists
 *    forever without reinforcement.
 *  - The two startup axioms ("i am the system", "the system is online") are
 *    crystallised at energy 2.0 so they survive all cull cycles.
 */
export class SelfConcept {
  /** Manifold ID of the permanent self-precept at (0,0,0,0). */
  public selfId = -1;
  /** Scope shared by all first-person pronouns. */
  public selfScope = -1;

  private static readonly MASS_FACTOR = 10;

  /**
   * Creates the origin precept and ingests the two foundational axioms.
   * Safe to call multiple times - subsequent calls are no-ops if selfId is valid.
   */
  public async initialize(
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store?: Store
  ): Promise<void> {
    if (this.selfId !== -1) return;

    this.selfScope = atomizer.getSymbolScope("i", false);

    const selfMass = system.c ** 2 * SelfConcept.MASS_FACTOR;
    this.selfId = system.createLocation(
      selfMass,
      this.selfScope,
      "self_concept"
    );

    system.posX[this.selfId] = 0;
    system.posY[this.selfId] = 0;
    system.posZ[this.selfId] = 0;
    system.posW[this.selfId] = 0;
    system.decayRate[this.selfId] = 0;
    system.update(this.selfId, "self_concept");

    logger.debug(
      `[SELF] origin precept id=${this.selfId} scope=${this.selfScope} mass=${selfMass.toFixed(1)}`
    );

    const onlineIds = atomizer.ingestSequence("the system is online", system);
    const selfSystemIds = atomizer.ingestSequence("i am the system", system);

    if (store) {
      await store.waitForInit();

      const iAmIds = atomizer.ingestSequence("i am", system);
      const theSystemIds = atomizer.ingestSequence("the system", system);
      await store.crystallizeProof(iAmIds, theSystemIds, 2.0);

      const sysIsIds = atomizer.ingestSequence("the system is", system);
      const onlineSlice = atomizer.ingestSequence("online", system);
      await store.crystallizeProof(sysIsIds, onlineSlice, 2.0);

      await store.crystallizeProof(selfSystemIds, onlineIds, 2.0);

      logger.debug("[SELF] foundational axioms crystallised at energy 2.0");
    }
  }

  /** True if the sequence contains at least one token with the self-scope. */
  public isSelfReferential(
    sequenceIds: Uint32Array,
    system: Root.ManifoldView
  ): boolean {
    if (this.selfScope === -1) return false;
    for (let i = 0; i < sequenceIds.length; i++) {
      if (system.scope[sequenceIds[i]] === this.selfScope) return true;
    }
    return false;
  }
}

// Perspective rewriting

/**
 * Transforms second-person input (directed AT the system) into first-person
 * form so the manifold processes it from the system's own point of view.
 *
 * "you" always refers to the system itself in this context, so the
 * transformation is unconditional.  Verb agreement is handled before
 * standalone pronoun substitution to avoid double-replacement
 * ("are you" → "am i", not "are i" → "am i").
 */
export function shiftPerspective(text: string): string {
  let q = text.replace(/\?$/, "").trim();

  // Identity questions collapse to the form that Phase-0b resolves against
  // the crystallised "i am the system" vault proof.
  q = q.replace(/^(who|what)\s+are\s+you(\s+.*)?$/i, (_, _wh, rest) =>
    rest ? `i am${rest}` : "i am"
  );

  // Declarative patterns ("you are X") before interrogative ("are you?") to
  // prevent double-replacement.
  q = q
    .replace(/\byou are\b/gi, "i am")
    .replace(/\byou were\b/gi, "i was")
    .replace(/\byou will be\b/gi, "i will be")
    .replace(/\byou would be\b/gi, "i would be")
    .replace(/\byou have\b/gi, "i have")
    .replace(/\byou had\b/gi, "i had")
    .replace(/\byou do\b/gi, "i do")
    .replace(/\byou did\b/gi, "i did")
    .replace(/\byou can\b/gi, "i can")
    .replace(/\byou could\b/gi, "i could")
    .replace(/\byou should\b/gi, "i should")
    .replace(/\byou will\b/gi, "i will")
    .replace(/\byou would\b/gi, "i would");

  q = q
    .replace(/\bare you\b/gi, "am i")
    .replace(/\bdo you\b/gi, "do i")
    .replace(/\bcan you\b/gi, "can i")
    .replace(/\bhave you\b/gi, "have i")
    .replace(/\bwere you\b/gi, "was i")
    .replace(/\bwill you\b/gi, "will i")
    .replace(/\bwould you\b/gi, "would i")
    .replace(/\bcould you\b/gi, "could i")
    .replace(/\bdid you\b/gi, "did i")
    .replace(/\bshould you\b/gi, "should i");

  q = q
    .replace(/\byourself\b/gi, "myself")
    .replace(/\byour\b/gi, "my")
    .replace(/\byours\b/gi, "mine");

  q = q.replace(/\byou\b/gi, "i");

  return q;
}

/**
 * True if the original (pre-shift) query was an identity question about
 * the system ("who are you?", "what are you?").  Used by the Listener to
 * reconstruct the full first-person response from a resolved object token.
 */
export function isIdentityQueryAboutSelf(query: string): boolean {
  return /^(who|what)\s+are\s+you(\s.*)?$/i.test(
    query.replace(/\?$/, "").trim()
  );
}

export default SelfConcept;
