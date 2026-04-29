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
