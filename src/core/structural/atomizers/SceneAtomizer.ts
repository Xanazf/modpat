import { DOPAT_CONFIG } from "@config";
import { OperatorClass } from "@core_i/helpers/enums";
import { BaseAtomizer } from "./BaseAtomizer";

/**
 * SceneAtomizer - the clean object↔word map for the vision channel (Phase 6).
 *
 * A scene is a graph of ENTITIES, not a logical sentence: there are no operators
 * (no attractors that warp the field), and an object's label IS its identity -
 * "the red ball" is one body, never rewritten or split. So this atomizer keeps a
 * verbatim object→scope map: `getSymbolScope("red ball")` interns the whole
 * phrase, with none of the operator / pronoun / arithmetic canonicalisation the
 * logic and language atomizers apply (those would corrupt object identity).
 *
 * Entities materialise as weightless particles (mass = c), the dual of
 * LogicAtomizer's massive operator attractors; their positions come from the
 * structural placement (groundGraphIntoSystem), with the GloVe/UMAP coordinate
 * only a cold-start hint exactly as in the other atomizers.
 */
export default class SceneAtomizer
  extends BaseAtomizer
  implements Atomic.Engine
{
  public async init(): Promise<void> {}

  /**
   * Clean object→word map: the entity's label is its scope, verbatim
   * (lower-cased + trimmed by `getSymbolIdx`). No operator flag, no canonical
   * rewriting - a scene has no operators and object identity is literal.
   */
  public getSymbolScope(symbol: string, _isOperator?: boolean): number {
    return this.getSymbolIdx(symbol);
  }

  /**
   * Materialises a scene description into entity bodies. Objects are separated
   * by commas, semicolons, or newlines; each phrase becomes ONE particle (scenes
   * carry no operator attractors). Grounding/placement is the authoritative
   * source of position - this just lays a cold-start coordinate.
   */
  public ingestSequence(text: string, system: Root.ManifoldView): Uint32Array {
    const objects = text
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const ids = new Uint32Array(objects.length);
    let prevId = 0; // NULL
    for (let i = 0; i < objects.length; i++) {
      const label = objects[i];
      const scope = this.getSymbolScope(label);
      const id = system.createLocation(system.c, scope);

      if (prevId !== 0) {
        system.PartLayer[prevId] = id;
        system.ComplexLayer[id] = prevId;
      }
      prevId = id;

      system.operatorClass[id] = OperatorClass.None;
      ids[i] = id;

      system.depth[id] = 0.5;
      system.time[id] = i * 0.01;
      system.posX[id] = this.groundedPosX(
        system,
        scope,
        this.loader.getScope(label),
        id
      );
      system.posY[id] = i * 0.1;
      system.posZ[id] = system.depth[id];
      system.posW[id] = DOPAT_CONFIG.PHYSICS.AGE_FRESHNESS;
      system.update(id);
    }
    return ids;
  }

  public ingestPattern(
    template: string,
    _slotTypes: Map<number, number>,
    system: Root.ManifoldView
  ): Uint32Array {
    return this.ingestSequence(template, system);
  }

  public decodeSequence(
    sequenceIds: Uint32Array,
    system: Root.ManifoldView
  ): string {
    const output: string[] = [];
    for (let i = 0; i < sequenceIds.length; i++) {
      output.push(this.resolveScope(system.scope[sequenceIds[i]]) ?? "<?>");
    }
    return output.join(", ");
  }
}
