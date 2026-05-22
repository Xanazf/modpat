import {
  type Hexadectree,
  type HexadectreeNode,
  hexadectree,
} from "d3-hexadectree";

export interface BHAtom {
  id: number;
  x: number;
  y: number;
  z: number;
  w: number;
  mass: number;
}

export interface BHNodeInfo {
  mass: number;
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * 4D Barnes-Hut many-body gravity approximation helper.
 * Uses d3-hexadectree hierarchical space division to compute
 * centers of mass and execute query traversals.
 */
export class BarnesHut4D {
  private readonly tree: Hexadectree<BHAtom>;
  private readonly nodeInfo = new WeakMap<
    HexadectreeNode<BHAtom>,
    BHNodeInfo
  >();

  constructor(atoms: BHAtom[]) {
    this.tree = hexadectree<BHAtom>()
      .x((d: BHAtom) => d.x)
      .y((d: BHAtom) => d.y)
      .z((d: BHAtom) => d.z)
      .w((d: BHAtom) => d.w)
      .addAll(atoms);

    this.computeCenterOfMass();
  }

  /**
   * Post-order traversal to assign centers of mass to all internal tree nodes.
   */
  private computeCenterOfMass(): void {
    const root = this.tree.root();
    if (!root) return;

    this.tree.visitAfter((node, _x0, _y0, _z0, _w0, _x1, _y1, _z1, _w1) => {
      let totalMass = 0;
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let sumW = 0;

      if (node.length === 16) {
        // Internal node - accumulate child node masses and weighted coordinates
        for (let i = 0; i < 16; i++) {
          const child = node[i];
          if (!child) continue;

          const info = this.getInfo(child);
          totalMass += info.mass;
          sumX += info.x * info.mass;
          sumY += info.y * info.mass;
          sumZ += info.z * info.mass;
          sumW += info.w * info.mass;
        }
      } else {
        // Leaf node - aggregate current and duplicate coincident data points
        let current: HexadectreeNode<BHAtom> | undefined = node;
        while (current) {
          const d = current.data;
          if (d) {
            totalMass += d.mass;
            sumX += d.x * d.mass;
            sumY += d.y * d.mass;
            sumZ += d.z * d.mass;
            sumW += d.w * d.mass;
          }
          current = current.next;
        }
      }

      if (totalMass > 0) {
        this.nodeInfo.set(node, {
          mass: totalMass,
          x: sumX / totalMass,
          y: sumY / totalMass,
          z: sumZ / totalMass,
          w: sumW / totalMass,
        });
      } else {
        this.nodeInfo.set(node, { mass: 0, x: 0, y: 0, z: 0, w: 0 });
      }
    });
  }

  private getInfo(node: HexadectreeNode<BHAtom>): BHNodeInfo {
    const info = this.nodeInfo.get(node);
    if (info) return info;

    let totalMass = 0;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let sumW = 0;

    let current: HexadectreeNode<BHAtom> | undefined = node;
    while (current) {
      const d = current.data;
      if (d) {
        totalMass += d.mass;
        sumX += d.x * d.mass;
        sumY += d.y * d.mass;
        sumZ += d.z * d.mass;
        sumW += d.w * d.mass;
      }
      current = current.next;
    }

    return {
      mass: totalMass,
      x: totalMass > 0 ? sumX / totalMass : 0,
      y: totalMass > 0 ? sumY / totalMass : 0,
      z: totalMass > 0 ? sumZ / totalMass : 0,
      w: totalMass > 0 ? sumW / totalMass : 0,
    };
  }

  /**
   * Computes long-range forces/influence at a query point.
   * Traverses the tree recursively using the Barnes-Hut theta criterion.
   */
  computeForce(
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    theta = 0.9,
    forceAccumulator: (
      tx: number,
      ty: number,
      tz: number,
      tw: number,
      mass: number
    ) => void
  ): void {
    const root = this.tree.root();
    if (!root) return;

    const extent = this.tree.extent();
    if (!extent) return;

    const [[ex0, ey0, ez0, ew0], [ex1, ey1, ez1, ew1]] = extent;

    const stack: Array<{
      node: HexadectreeNode<BHAtom>;
      x0: number;
      y0: number;
      z0: number;
      w0: number;
      x1: number;
      y1: number;
      z1: number;
      w1: number;
    }> = [];

    stack.push({
      node: root,
      x0: ex0,
      y0: ey0,
      z0: ez0,
      w0: ew0,
      x1: ex1,
      y1: ey1,
      z1: ez1,
      w1: ew1,
    });

    while (stack.length > 0) {
      const { node, x0, y0, z0, w0, x1, y1, z1, w1 } = stack.pop()!;
      const info = this.nodeInfo.get(node);
      if (!info || info.mass === 0) continue;

      const dx = info.x - qx;
      const dy = info.y - qy;
      const dz = info.z - qz;
      const dw = info.w - qw;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);

      if (dist === 0) continue;

      const width = Math.max(x1 - x0, y1 - y0, z1 - z0, w1 - w0);

      if (node.length !== 16 || width / dist < theta) {
        // Node is sufficiently far, aggregate its force contributions
        forceAccumulator(info.x, info.y, info.z, info.w, info.mass);
      } else {
        // Node is too close, recurse into children
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const mz = (z0 + z1) / 2;
        const mw = (w0 + w1) / 2;

        for (let i = 0; i < 16; i++) {
          const child = node[i];
          if (!child) continue;

          const bx0 = i & 1 ? mx : x0;
          const bx1 = i & 1 ? x1 : mx;
          const by0 = i & 2 ? my : y0;
          const by1 = i & 2 ? y1 : my;
          const bz0 = i & 4 ? mz : z0;
          const bz1 = i & 4 ? z1 : mz;
          const bw0 = i & 8 ? mw : w0;
          const bw1 = i & 8 ? w1 : mw;

          stack.push({
            node: child,
            x0: bx0,
            y0: by0,
            z0: bz0,
            w0: bw0,
            x1: bx1,
            y1: by1,
            z1: bz1,
            w1: bw1,
          });
        }
      }
    }
  }
}
