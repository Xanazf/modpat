import { OperatorClass } from "@core_i/helpers/enums";

export enum IntentTag {
  INQUIRY_GAP = 0,
  CONSTELLATION_GAP = 1,
  VAULT_PROMOTE = 2,
  USER_UNKNOWN = 3,
}

/**
 * Creates a manifold-native Intent precept for a topic.
 * The returned ID is registered in the caller-supplied tag map.
 * Returns null if the topic has no known scope.
 */
export function spawnIntent(
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  topic: string,
  urgency: number,
  tag: IntentTag,
  tagMap: Map<number, IntentTag>
): number | null {
  const scope = atomizer.getSymbolScope(topic.toLowerCase().trim(), false);
  if (scope < 0) return null;
  const id = system.createLocation(Math.max(urgency, 0.1), scope);
  system.operatorClass[id] = OperatorClass.Intent;
  tagMap.set(id, tag);
  return id;
}

export function decayIntent(
  system: Root.ManifoldView,
  id: number,
  factor: number
): void {
  system.mass[id] *= factor;
  system.update(id);
}

export function boostIntent(
  system: Root.ManifoldView,
  id: number,
  factor: number
): void {
  system.mass[id] *= factor;
  system.update(id);
}
