/**
 * Listener - DEPRECATED. Phase 4 of the "Mapper as Thinker" refactor moved
 * text-parsing logic to Language and the resonance pipeline to Mapper.
 * This file remains as a back-compat shim so any lingering imports keep
 * compiling. New code should use Language.ingest() and Mapper.process().
 */

import type Mapper from "./Mapper";
import type { PerceptionDiagnostics } from "./Mapper";

export { isCodeIntent } from "./language/Language";

export type ResolverDiagnostics = PerceptionDiagnostics;

export interface ListenerOptions {
  contextScopes?: Set<number>;
}

export interface ListenerResult {
  text: string;
  diagnostics: PerceptionDiagnostics | null;
}

/** @deprecated Use Mapper.process() / Mapper.perceiveCoherent() directly. */
class Listener {
  private mapper: Mapper;
  public lastSignature: string | null = null;

  constructor(
    _system: unknown,
    _atomizer: unknown,
    mapper: Mapper,
    _store?: unknown,
    _unfolder?: unknown,
    _respond?: unknown
  ) {
    this.mapper = mapper;
  }

  async processQuestion(
    query: string,
    _opts: ListenerOptions = {}
  ): Promise<ListenerResult> {
    const text = await this.mapper.process(query);
    this.lastSignature = this.mapper.lastSignature;
    return { text, diagnostics: this.mapper.lastDiagnostics };
  }
}

export default Listener;
