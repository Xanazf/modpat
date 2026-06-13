/**
 * Enumeration of physical property buffers within the logical manifold.
 * These buffers correspond to the different dimensions of a logical precept's existence.
 */
export enum TargetBuffer {
  /** Matter: The logical importance or content of posX. */
  Mass = 0,
  /** Kind: The structural identifier or content of posY. */
  Scope = 1,
  /** Energy: The logical potential or content of posZ. */
  Depth = 2,
  /** Age: The temporal state or content of posW. */
  Time = 3,
  /** Topological X-coordinate (Matter). */
  PosX = 4,
  /** Topological Y-coordinate (Kind). */
  PosY = 5,
  /** Topological Z-coordinate (Energy). */
  PosZ = 6,
  /** Topological W-coordinate (Age). */
  PosW = 7,
  /** Matter Density (Mass / Scope) at posX:posY. */
  Density = 8,
  /** Temporal Decay Rate (Time / Scope) at posW:posY. */
  EntropyRate = 9,
  /** Logical Potency (Depth / Mass) at posZ:posX. */
  Potency = 10,
  /** Logical Intensity (Depth / Scope) at posZ:posY. */
  Intensity = 11,
  /** Per-precept rate of logical decay. */
  DecayRate = 12,
  /** Physical hash of the precept's state for integrity. */
  Checksum = 13,
}

/**
 * Bitmask enum for VAR slot roles within a code pattern.
 * Stored in system.slotType[] so the Mapper can perceive and attract toward
 * continuation points during geodesic path relaxation.
 */
export enum SlotType {
  None = 0,
  Leaf = 1 << 0, // concrete identifier or literal
  Body = 1 << 1, // sub-pattern continuation
  Condition = 1 << 2, // boolean expression
  Parameter = 1 << 3, // argument / parameter list
  TypeHint = 1 << 4, // type annotation
}

/**
 * Classification of logical operators as "massive bodies" that attract and define
 * the relationships between variables in the heat field.
 */
export enum OperatorClass {
  /** No operator assigned. */
  None = 0,
  /** Operators that shift the identity or state (e.g., "is", "becomes"). */
  IdentityShift = 1,
  /** Logical conjunctions (e.g., "and", "but"). */
  Conjunction = 2,
  /** A logical sink or conclusion point (e.g., "therefore"). */
  Sink = 3,
  /** Existential or universal quantifiers. */
  Quantifier = 4,
  /** Modifiers that define the scope of a statement (e.g., "all", "some"). */
  Modifier = 5,
  /** Logical negation or inversion. */
  Inversion = 6,
  /** Action-oriented operators that define events or transformations. */
  Action = 7,
  /** Query-based operators used for logical interrogation. */
  Query = 8,
  /** Syntactic landmarks for physicalized code synthesis. */
  SyntaxAnchor = 9,
  /** Proactive curiosity signal spawned by motivation sources (CognitiveLoop). */
  Intent = 10,
  /** Binary arithmetic operators (+, -, *, /, plus, minus, times, divided). */
  Arithmetic = 11,
  /** Capability anchor: skill attractor that the Mapper navigates toward. */
  Capability = 12,
}
