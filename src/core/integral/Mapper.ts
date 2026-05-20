/**
 * Mapper — back-compat shim.
 *
 * The inferential traveler was renamed to Traveler (B0) to free the name
 * "Mapper" for the TDA Mapper algorithm (Phase B).  All existing imports
 * of @core_i/Mapper continue to compile via this re-export.
 *
 * New code should import from @core_i/Traveler.
 */

export {
  default,
  type Mapper,
  type PerceptionOptions,
  type ResolveOptions,
  type CoherentResult,
  type BridgeCandidate,
  type DiscoveredOperator,
  type PerceptionDiagnostics,
  type ResolverDiagnostics,
  type PerceptionCapture,
} from "./Traveler";
