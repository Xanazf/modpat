/**
 * Resolver - DEPRECATED. The Resolver was the Mapper's perception engine,
 * factored out incorrectly. Phase 2 of the "Mapper as Thinker" refactor
 * merged it back into Mapper. This file remains only as a back-compat shim
 * so existing imports (tests, REPL, etc.) keep compiling during the
 * transition. It will be removed after all consumers migrate to Mapper.
 */

import Mapper from "./Mapper";

export type {
  PerceptionDiagnostics as ResolverDiagnostics,
  PerceptionOptions as ResolveOptions,
  CoherentResult,
  BridgeCandidate,
  DiscoveredOperator,
} from "./Mapper";

export default Mapper;
