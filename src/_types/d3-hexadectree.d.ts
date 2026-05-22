declare module "d3-hexadectree" {
  export interface HexadectreeNode<T> {
    length?: 16;
    [index: number]: HexadectreeNode<T> | undefined;
    data?: T;
    next?: HexadectreeNode<T>;
  }

  export interface Hexadectree<T> {
    root(): HexadectreeNode<T> | undefined;
    add(datum: T): this;
    addAll(data: T[]): this;
    remove(datum: T): this;
    removeAll(data: T[]): this;
    copy(): Hexadectree<T>;
    data(): T[];
    size(): number;
    extent():
      | [[number, number, number, number], [number, number, number, number]]
      | undefined;
    extent(
      ext: [[number, number, number, number], [number, number, number, number]]
    ): this;
    find(
      x: number,
      y: number,
      z: number,
      w: number,
      radius?: number
    ): T | undefined;
    findAllWithinRadius(
      x: number,
      y: number,
      z: number,
      w: number,
      radius: number
    ): T[];
    visit(
      callback: (
        node: HexadectreeNode<T>,
        x0: number,
        y0: number,
        z0: number,
        w0: number,
        x1: number,
        y1: number,
        z1: number,
        w1: number
      ) => boolean | void
    ): this;
    visitAfter(
      callback: (
        node: HexadectreeNode<T>,
        x0: number,
        y0: number,
        z0: number,
        w0: number,
        x1: number,
        y1: number,
        z1: number,
        w1: number
      ) => void
    ): this;
    x(): (d: T) => number;
    x(fn: (d: T) => number): this;
    y(): (d: T) => number;
    y(fn: (d: T) => number): this;
    z(): (d: T) => number;
    z(fn: (d: T) => number): this;
    w(): (d: T) => number;
    w(fn: (d: T) => number): this;
  }

  export function hexadectree<T>(
    data?: T[],
    x?: (d: T) => number,
    y?: (d: T) => number,
    z?: (d: T) => number,
    w?: (d: T) => number
  ): Hexadectree<T>;
}
