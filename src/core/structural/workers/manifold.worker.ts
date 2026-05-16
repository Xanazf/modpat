/**
 * manifold.worker - Constellation / gap / orbital computation in an isolated thread.
 *
 * Receives the System's SharedArrayBuffer (zero-copy) and a ManifoldLayout so it
 * can reconstruct typed-array views without importing the System class.
 * All computation is read-only; results are posted back as plain JSON-able objects.
 */

import { parentPort, workerData } from "node:worker_threads";
import type { ManifoldLayout } from "@core_i/System";
import { GridIndex4D } from "@core_s/GridIndex4D";
import type { Constellation } from "@core_s/ManifoldMetrics";
import {
  constellations,
  distance4D,
  orbitalParent,
  orbitRadius,
  satellites,
} from "@core_s/ManifoldMetrics";
import { ManifoldReader } from "@core_s/ManifoldReader";

// Raw gap record: no labels (atomizer not available in worker; main thread enriches).
export interface RawGap {
  constellationIdx: number;
  atomA: number;
  atomB: number;
  distance: number;
  gapScore: number;
}

interface WorkerInit {
  buffer: SharedArrayBuffer;
  layout: ManifoldLayout;
}

const { buffer, layout } = workerData as WorkerInit;

// Cached reader - reused for every task; length is patched per-message.
const reader = new ManifoldReader(buffer, layout, 0);

// Cached spatial index - rebuilt when length changes significantly (≥5% growth).
let cachedIndex: GridIndex4D | null = null;
let cachedIndexLength = 0;

function getIndex(length: number): GridIndex4D {
  if (!cachedIndex || length - cachedIndexLength > cachedIndexLength * 0.05) {
    cachedIndex = new GridIndex4D(50);
    for (let i = 1; i < length; i++) {
      if (reader.allocated[i] === 1) {
        cachedIndex.insert(
          i,
          reader.posX[i],
          reader.posY[i],
          reader.posZ[i],
          reader.posW[i]
        );
      }
    }
    cachedIndexLength = length;
  }
  return cachedIndex;
}

interface ManifoldRequest {
  id: number;
  type: "constellations" | "gaps" | "orbital";
  length: number;
  // for gaps, we also receive the previously-computed constellations list
  consts?: Constellation[];
}

function computeRawGaps(
  consts: Constellation[],
  opts: { maxPerConstellation?: number; minMassRatio?: number }
): RawGap[] {
  const { maxPerConstellation = 2, minMassRatio = 0.05 } = opts;
  const minMass = reader.c * minMassRatio;
  const result: RawGap[] = [];

  for (let ci = 0; ci < consts.length; ci++) {
    const c = consts[ci];
    if (c.members.length < 3) continue;
    const heavy = c.members.filter(
      id => reader.isAllocated(id) && Math.abs(reader.mass[id]) >= minMass
    );
    if (heavy.length < 2) continue;

    const pairGaps: { a: number; b: number; dist: number; score: number }[] =
      [];
    for (let i = 0; i < heavy.length; i++) {
      for (let j = i + 1; j < heavy.length; j++) {
        const a = heavy[i],
          b = heavy[j];
        const dist = distance4D(a, b, reader as any);
        const rA = orbitRadius(a, reader as any);
        const rB = orbitRadius(b, reader as any);
        const combined = rA + rB;
        if (combined === 0) continue;
        const tension = dist / combined;
        const mass = Math.abs(reader.mass[a]) + Math.abs(reader.mass[b]);
        pairGaps.push({ a, b, dist, score: tension * mass });
      }
    }
    pairGaps.sort((x, y) => y.score - x.score);
    for (const { a, b, dist, score } of pairGaps.slice(
      0,
      maxPerConstellation
    )) {
      result.push({
        constellationIdx: ci,
        atomA: a,
        atomB: b,
        distance: dist,
        gapScore: score,
      });
    }
  }
  return result;
}

parentPort!.on("message", (msg: ManifoldRequest) => {
  reader.length = msg.length;
  const { id, type, length } = msg;

  try {
    if (type === "constellations") {
      const index = getIndex(length);
      const result = constellations(reader as any, { index });
      parentPort!.postMessage({ id, result });
    } else if (type === "gaps") {
      const consts = msg.consts ?? [];
      const result = computeRawGaps(consts, {
        maxPerConstellation: 2,
        minMassRatio: 0.05,
      });
      parentPort!.postMessage({ id, result });
    } else if (type === "orbital") {
      const index = getIndex(length);
      const results: Array<{
        id: number;
        parentId: number | null;
        radius: number;
        satelliteCount: number;
      }> = [];

      for (let i = 1; i < length; i++) {
        if (reader.allocated[i] !== 1) continue;
        const parentId = orbitalParent(i, reader as any, index);
        const radius = orbitRadius(i, reader as any);
        const sats = satellites(i, reader as any, index);
        if (parentId !== null || sats.length > 0) {
          results.push({
            id: i,
            parentId,
            radius,
            satelliteCount: sats.length,
          });
        }
      }
      parentPort!.postMessage({ id, result: results });
    }
  } catch (err: any) {
    parentPort!.postMessage({ id, error: err?.message ?? String(err) });
  }
});
