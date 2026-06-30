# Theoretical Notes - ModPAT

Raw notes from a working session. Not polished.

***

## The Core Claim

Every conceptual space has a topology. Topology is not a metaphor here - it is the literal claim that every domain (logic, memory, cognition, hardware) has a shape, and that shape determines which traversals are valid, which are costly, and which are impossible.

The CPU cache line is the clearest proof of this. Cache topology is fixed in hardware.

Write code whose memory access pattern aligns with it (SOA) and you get an order of magnitude speedup. The topology doesn't care about your intent. It just is. You either work with it or against it.

The claim of ModPAT is that logical inference works the same way: validity isn't checked against rules, it's energetically favored by geometry.

***

## Fields Are Functions

The Higgs field is not a "thing" - it's a function. An assignment: at every point in spacetime, a value. A scalar field is `f: M → ℝ`. A vector field is `f: M → TM`.

"Field" is shorthand for "the topology of a domain plus a rule for what lives at each point."

The DOPAT manifold is the same idea. Operators are attractors (massive bodies that curve the space around them). Variables are particles. Inference is movement through the space they jointly define. The physics is not a metaphor for the logic - the physics _is_ the logic, stated geometrically.

This is also the core claim of category theory:
  * every domain has **objects** and _morphisms_, **things** and _the structure-preserving maps_ between them.
  * topology studies what's preserved under continuous deformation. ModPAT is topology applied to the space of thought.

***

## Intent Is Not a Force

The standard cognitive science framing: intent is a goal-directed force. Desire pulls you toward an attractor. This has a hidden assumption - that "wanting" and "reason" are separate things that then get connected by some relation.

The wave model dissolves this. Intent is not a force that pushes. It is a surviving constructive interference of a wave that propagated along an uneven topology.

"I want to eat" because "I am hungry" - these two precepts have constructive interference. The wave survives.

"I want to play games" because "I have work to do" - destructive interference. The wave cancels. The intent fails to constitute itself. That's why the contradiction feels wrong, not just logically false. It doesn't fail a check. The wave doesn't arrive.

This also explains degrees of motivation naturally. "I want to eat because I'm slightly hungry" is weaker constructive interference than "I want to eat because I'm starving." Same topology, different amplitude. The geometry scales continuously.

***

## OR as Median

Logical OR is not a special case bolted onto the wave model. It falls out of it naturally.

Two waves that partially interfere - don't fully align, don't cancel - produce a weighted superposition. The median is the equilibrium point where neither wave dominates. This is "maybe" not as a hedge or an epistemic flag, but as a precise physical state: partial constructive interference below the threshold of full commitment.

> [!NOTE]
> To Be Reconciled with conceptual construction mechanics (`water + fire = steam`)

***

## Rationalization vs. Reasoning - The W Dimension

Waves propagate in all directions at once, including along the age (W) dimension. This is the key to distinguishing genuine reasoning from rationalization.

### **Forward propagation (reasoning)**

A precept at time T₀ fires. Its wave propagates forward along W, finds constructive interference with later precepts, and an intent stabilizes as a conclusion that emerged from prior evidence.

### **Backward propagation (rationalization)**

An intent fires at time T₁. Its wave propagates backward along W - toward older precepts - and finds constructive interference with memory records from the past. Those records become the "justification." The coherence is real - the wave genuinely found constructive nodes. But the directionality on W is opposite.

Rationalization isn't fake coherence. It's real coherence in the wrong direction.

This is why the dual age system is load-bearing, not bookkeeping:
  * **Precept age (local freshness):** how recently the precept was activated
  * **Global age (manifold time):** absolute temporal position in the topology

Without both, forward and backward propagation look identical as interference patterns.
With both, the direction the wave was traveling on W when it found its constructive nodes becomes a measurable property of the inference.

### **Falsifiability condition**

Rationalizations, once backward decay is fully wired, will be systematically lower amplitude than conclusions from forward propagation - because they traveled against the density gradient of established knowledge to find their support.

***

## Decay

`decayRate` is applied to mass and age. A decaying precept loses logical weight (mass) and freshness (precept age). The rate is constant across all precepts except foundational ones (e.g. "the system is online") which are exempt.

Consequence: a high-energy intent propagating backward on W that finds only weak justification nodes will attenuate. If it finds nothing substantial, it doesn't stabilize - it either collapses or persists as unresolved tension (wanting something you can't justify even to yourself).

Once backward propagation decay is fully active, the system won't just be able to represent the distinction between reasoning and rationalization - it will produce the distinction as an output property. Rationalizations will be measurably lower amplitude.

***

## Parallels

Constitutional AI (i.e. Anthropic's Claude) trains a model by using a fixed set of principles as a rubric to generate self-critiques and AI preference labels, which then shape the weights via RL. The constitution is a training-time document - by inference time it's gone, absorbed into the model's weights.

ModPAT is an explicit, geometric version of the same idea. The manifold topology is the constitution. It doesn't disappear into weights - it remains as the literal shape of the space that inference has to traverse.

The difference is in that an LLM's constraints are implicit and statistical, while ModPAT's are explicit and geometric. Both solve the same problem: how do you make an inference system consistently prefer certain kinds of conclusions without encoding every case by hand.

***

## The Concept

The architecture that _ought to be_: a system where inference aligns with conceptual topology the same way memory access aligns with cache lines. Not rules, not weights, but geometry and physics.

The coherence of a conclusion is a physical property of how the wave propagated, not a post-hoc logical check.

***

## Potentially better System documentation

> [!NOTE]
> Not to be confused with AoS.
> The System stays SoA, this is only a more readable description.

4 dimensions - x,y,z,w, where W is time, stays. Each dimension should be orthogonal, forming the navigation space.

```ts
interface NavigationSpace {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  w: Float64Array;
}
```

***

5th dimension - structurally a `type` dimension, all the ways an item at `[x,y,z,w]` can be, i.e. the parameter space of the item at those coordinates.

```ts
// indexes within NavigationSpace
interface SpaceTimeColumn {
  x: number; // Uint32
  y: number; // Uint32
  z: number; // Uint32
  w: number; // Uint32
}
interface ParameterSpace {
  coord: SpaceTimeColumn;

  // any parameters necessary to eval an Atom
  [key: string]?: Float64Array;
}
type Atom = ParameterSpace;
```

***

6th dimension - structurally a `namespace` dimension, i.e. the parameter space of every prior dimension. Has to be self-generating/lazy-loaded capability.

While it is orthogonal, it should follow the shape of the navigation space (e.g. like a tesseract extruded from 3D).

```ts
namespace Dimension6 {
  interface PotentialSpace {
    existing_coords: Float64Array;

    // Float64 for additional parametrics described below
    // the [key: string] should only be indicative of:
    // "any new parameter is possible to attribute, but it should logically follow"
    [key: string]?: Float64Array;
  }

  // ---

  interface PosX extends PotentialSpace {
    // mass/charge follow from X as X is a beam, a line that has a beginning but no end
    // therefore: it accumulates (in general terms)
    mass: Float64Array;
    charge?: Float64Array;
  }

  interface PosY extends PotentialSpace {
    // scope/kind follow from Y as Y is orthogonal to X
    // with Y it's possible to form a coordinate and quantify mass
    scope: Float64Array;
    kind?: Float64Array;
  }

  // ---

  // The first possible coordinate (index of the coordinate)
  type FlatSpaceColumn = Omit<SpaceTimeColumn, "z"|"w">;

  // ---

  interface PosZ extends PotentialSpace {
    // depth/energy follow from Z as Z is orthogonal to both X and Y
    // with Z it's possible to qualify the type of influence and quantify its effect
    depth: Float64Array;
    energy?: Float64Array;
  }

  // ---

  // The second possible coordinate (index of the coordinate)
  type DeepSpaceColumn = Omit<SpaceTimeColumn, "w">;

  // ---

  interface PosW extends PotentialSpace {
    // age/timestamp follow from W as W is orthogonal to all 3 prior dimensions
    // makes possible a qualitatively different form of analysis:
    //  - when did/will the Atom at xyz start influencing;
    //  - when did/will it stop influencing;
    //  - how long has it been influencing, if applicable;

    // formation of System-bound timeline needed to construct before 1970
    // Int32 (signed integers) is to form "before" (-int) and "after" (+int)
    timestamp: Int32Array; // Int32 of Unix-like time
    age?: Float64Array;
  }
}
```
