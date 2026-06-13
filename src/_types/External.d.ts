// INFO: Iterative
/**
 * Typed deltas posted by async producers (dreamCycle, Unfolder, GPU readbacks)
 * and drained synchronously by ManifoldLifecycle.tick().
 */
declare namespace Delta {
  interface Ingest {
    kind: "ingest";
    text: string;
    basePosX: number;
    basePosY: number;
    factDisplacementZ: number;
  }

  interface Update {
    kind: "update";
    id: number;
    field:
      | "mass"
      | "posX"
      | "posY"
      | "posZ"
      | "posW"
      | "decayRate"
      | "depth"
      | "time";
    value: number;
  }

  interface Free {
    kind: "free";
    id: number;
  }

  type Any = Ingest | Update | Free;
}

/**
 * Topological lifecycle events emitted by ManifoldLifecycle during its
 * low-frequency topology tick.  Consumers: dream-cycle prioritisation,
 * vault tagging, InquiryQueue curiosity seeding.
 */
declare namespace Topology {
  type Event =
    | { type: "component_birth"; persistence: number; atomId: number }
    | { type: "component_death"; persistence: number; atomId: number }
    | { type: "loop_appeared"; persistence: number; atomId: number }
    | { type: "loop_collapsed"; persistence: number; atomId: number };
}

declare namespace Wave {
  /**
   * Represents a single quantum of a logical signal.
   * It contains both real (amplitude/magnitude) and imaginary (phase) components,
   * allowing for complex wave-based logical interference.
   */
  type ComplexObject = {
    real: number;
    imag: number;
  };

  /**
   * Supported underlying array types for logical signal storage.
   */
  type HandleArray = Float32Array | Float64Array | Uint8ClampedArray | number[];

  type ArrayConstructor = {
    new (size: number): HandleArray;
    new (data: HandleArray): HandleArray;
  };

  /** Function signature for filtering frequency-space signals. */
  type Filterable = (value: ComplexObject, i: number, n: number) => void;
}

// INFO: Supportive
declare module "google-it" {
  /**
   * Options for the google-it search.
   */
  export interface Options {
    /** The search query string. */
    query?: string;
    /** Number of results to return. */
    limit?: number;
    /** Path to a file where results should be saved as JSON. */
    output?: string;
    /** Number of first results to open in the default browser. */
    open?: number;
    /** If true, the promise resolves to an object containing results, body, response, and stats. */
    returnHtmlBody?: boolean;
    /** Custom CSS selector for result titles. */
    titleSelector?: string;
    /** Custom CSS selector for result links. */
    linkSelector?: string;
    /** Custom CSS selector for result snippets. */
    snippetSelector?: string;
    /** Custom CSS selector for search stats. */
    resultStatsSelector?: string;
    /** Custom CSS selector for the pagination cursor. */
    cursorSelector?: string;
    /** The index of the first result to return (for pagination). */
    start?: number;
    /** If true, includes the raw response and body in the output. */
    diagnostics?: boolean;
    /** Prevent results from appearing in the terminal output. */
    "no-display"?: boolean;
    /** Disable all console logging from the library. */
    disableConsole?: boolean;
    /** If true, returns only the URLs of the results. */
    "only-urls"?: boolean;
    /** Custom user-agent string for the request. */
    userAgent?: string;
    /** Comma-separated list of sites to include. */
    includeSites?: string;
    /** Comma-separated list of sites to exclude. */
    excludeSites?: string;
    /** Path to a local HTML file to parse instead of making a network request. */
    fromFile?: string;
    /** HTML string to parse instead of making a network request. */
    fromString?: string;
  }

  /**
   * A single search result.
   */
  export interface Result {
    /** The title of the search result. */
    title?: string;
    /** The URL of the search result. */
    link?: string;
    /** The brief snippet/description of the result. */
    snippet?: string;
  }

  /**
   * The extended response returned when `diagnostics` or `returnHtmlBody` is true.
   */
  export interface ExtendedResult {
    /** Array of search results. */
    results: Result[];
    /** The raw HTML body of the search result page. */
    body: string;
    /** The full response object from the 'request' library. */
    response: any;
    /** Statistics about the search results. */
    stats: {
      /** The current page number. */
      page: number;
      /** Approximate number of total results. */
      approximateResults: string;
      /** Time taken for the search in seconds. */
      seconds: number;
    };
  }

  /**
   * Performs a Google search using the provided configuration.
   * @param config The search options.
   * @returns A promise that resolves to an array of results, or an extended result object if requested.
   */
  function googleIt(config: Options): Promise<Result[] | ExtendedResult>;

  export = googleIt;
}

declare module "abstract-syntax-tree" {
  export function parse(source: string, options?: Record<string, any>): any;
  export function generate(ast: any, options?: Record<string, any>): string;
  export function walk(
    ast: any,
    callback: (node: any, parent?: any) => void
  ): void;
  export function replace(ast: any, callback: (node: any) => any): void;
  export function find(ast: any, selector: string | Record<string, any>): any[];
  export function has(
    ast: any,
    selector: string | Record<string, any>
  ): boolean;
  export function each(
    ast: any,
    type: string,
    callback: (node: any) => void
  ): void;
}

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
