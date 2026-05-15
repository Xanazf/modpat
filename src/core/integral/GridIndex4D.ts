/**
 * 4D grid-bucket spatial index.
 * Assigns each node to a fixed-width cell so nearest-neighbor and radius
 * queries only visit a constant number of cells instead of the full manifold.
 *
 * Cell size drives the accuracy/cost trade-off:
 *   r = ceil(queryRadius / cellSize) cells checked per axis
 *   (2r+1)^4 total cells, most empty at moderate density.
 *
 * For INFLUENCE_RADIUS=400 (distSq threshold, actual radius~20) and
 * cellSize=10: r=2, 5^4=625 cells checked per query.
 */
export class GridIndex4D {
  private cells: Map<string, number[]> = new Map();
  private readonly cellSize: number;

  constructor(cellSize = 10) {
    this.cellSize = cellSize;
  }

  private key(x: number, y: number, z: number, w: number): string {
    const cx = Math.floor(x / this.cellSize) | 0;
    const cy = Math.floor(y / this.cellSize) | 0;
    const cz = Math.floor(z / this.cellSize) | 0;
    const cw = Math.floor(w / this.cellSize) | 0;
    return `${cx},${cy},${cz},${cw}`;
  }

  insert(id: number, x: number, y: number, z: number, w: number): void {
    const k = this.key(x, y, z, w);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(id);
  }

  remove(id: number, x: number, y: number, z: number, w: number): void {
    const k = this.key(x, y, z, w);
    const b = this.cells.get(k);
    if (!b) return;
    const i = b.indexOf(id);
    if (i !== -1) b.splice(i, 1);
    if (b.length === 0) this.cells.delete(k);
  }

  /**
   * Returns the id of the nearest node within `radius` (Euclidean, not squared).
   * Re-reads live positions from `view` to compute distances.
   * Returns -1 if no node is found within the search radius.
   */
  nearest(
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    radius: number,
    view: Root.ManifoldView
  ): number {
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(qx / this.cellSize) | 0;
    const cy = Math.floor(qy / this.cellSize) | 0;
    const cz = Math.floor(qz / this.cellSize) | 0;
    const cw = Math.floor(qw / this.cellSize) | 0;
    let bestId = -1,
      bestD2 = Infinity;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++)
          for (let dw = -r; dw <= r; dw++) {
            const bucket = this.cells.get(
              `${cx + dx},${cy + dy},${cz + dz},${cw + dw}`
            );
            if (!bucket) continue;
            for (const id of bucket) {
              const ddx = view.posX[id] - qx,
                ddy = view.posY[id] - qy,
                ddz = view.posZ[id] - qz,
                ddw = view.posW[id] - qw;
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw;
              if (d2 < bestD2) {
                bestD2 = d2;
                bestId = id;
              }
            }
          }
    return bestId;
  }

  /**
   * Returns all node ids whose cell falls within `radius` cells of the query.
   * Callers must re-check actual distance if they need strict radius filtering.
   */
  candidatesInRadius(
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    radius: number
  ): number[] {
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(qx / this.cellSize) | 0;
    const cy = Math.floor(qy / this.cellSize) | 0;
    const cz = Math.floor(qz / this.cellSize) | 0;
    const cw = Math.floor(qw / this.cellSize) | 0;
    const result: number[] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++)
          for (let dw = -r; dw <= r; dw++) {
            const bucket = this.cells.get(
              `${cx + dx},${cy + dy},${cz + dz},${cw + dw}`
            );
            if (bucket) for (const id of bucket) result.push(id);
          }
    return result;
  }

  clear(): void {
    this.cells.clear();
  }
}
