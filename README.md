# Modulated Praxis Attenuation Topology (ModPAT)

> [!NOTE]
> Can also be called Physically-Based Machine Reasoning
> but i wanted something with a lil more BOOM to it.

ModPAT is an experimental reasoning engine designed to explore logic through the lens of physics and topology. Instead of treating logic as a sequence of discrete boolean steps, this system maps relationships onto a four-dimensional manifold where deduction is achieved through pathfinding and signal analysis.

> [!NOTE]
> This video by 2swap illustrates the approach:
> <https://www.youtube.com/watch?v=YGLNyHd2w10>

## Prerequisites

* **Node.js**: v20 or higher
* **Yarn**: v4 (Berry)
* **Python**: 3.10+ (for UMAP preprocessing)
* **Vulkan/WebGPU**: Required for GPU acceleration (ensure `vulkan-loader` is installed on Linux)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Xanazf/modpat.git
   cd modpat
   ```

2. Install Node.js dependencies:
   ```bash
   yarn install
   ```

3. Setup Python environment for UMAP:
   ```bash
   python3 -m venv scripts/venv
   source scripts/venv/bin/activate
   pip install -r scripts/requirements.txt
   ```

## Getting Started

### 1. Download Semantic Data

ModPAT requires GloVe embeddings for its semantic manifold. Use the provided script to download and preprocess them (this will take some time and disk space):

```bash
# Download 50-dimensional GloVe vectors (Recommended for testing)
./getGlove.sh 50d
```

### 2. Run Tests

Verify the engine is working correctly on your hardware:

```bash
yarn test
```

### 3. Isolated inferences

Sometimes you need a more granular view into what's going on, here's the basic idea:

```bash
yarn tsx scripts/diagnose_fuzzy.ts
# or just "tsx ..."
```

### 4. Unused declarations

This architecture is highly abstract and hard to conceptualize, so keeping unused declarations helps maintain a mental model of the data flow map that you had in mind, which in turn helps in retracing steps.

## Core Concepts

### 1. Attractor Fields of Operator Precepts

The coordinate system is designed such that logical operators (relationships) act as primary structural anchors, while variables are secondary coordinates.

* **Operator Attraction:** Logic operators (e.g., `AND`, `OR`, `IMPLIES`) are initialized with high mass/density at fixed coordinates. During path relaxation, they exert potential attraction forces that pull path nodes toward them.
* **Variable Clustering:** Variable precepts (representing the tokens of a statement) are placed at low-mass coordinates clustered around these operator attractors. This allows the system to identify logical structures based on their geometric distribution rather than specific symbolic labels.

### 2. Topological Manifold Layout

Logical rules and assertions are represented as coordinate positions and spatial relations rather than discrete symbolic lists.

* **Coordinate Gradients:** An assertion or rule (such as `A implies B`) creates a coordinate path connecting those concepts within the manifold.
* **Structural Signatures:** By abstracting concrete variable names into generic relative offsets, the system matches statements of identical logical forms using their spatial layout. A rule learned in one context is recognized in another if its geometric signature matches.

## System Architecture

The core runtime contains two primary components:

* **System**: The manifold state. Holds the property arrays and enforces the coordinate schema.
* **Traveler**: The execution engine (exposed as `mapper` in the Runtime). It propagates activation/density across coordinates (perception), relaxes coordinate paths using gradient descent (locomotion), and reinforces successful paths in memory (learning). `mapper.process(text)` is the single entry point for all input.

A thin **Language** layer sits at the boundary: it tokenizes and projects natural language into manifold coordinates (ingest direction), and decodes final traveler coordinates back to text (express direction).

```
Natural language → Language.ingest() → Manifold (DOPAT) → Traveler.perceive() + traverse()
                         ↑                                          ↕
                  Language.express() ←-- Traveler.process() --  Memory Vault (DuckDB)
                                                    ↕
                                        Topology layer (TDA, Ricci flow,
                                        persistent homology, singularity remediation)
```

### Contiguous Memory Manifold (DOPAT)

State is stored in a single contiguous SharedArrayBuffer managed by `System.ts` for zero-copy concurrency. Each logical precept is represented as an index in this buffer, with the following properties:

* **Mass:** The structural attraction weight of the precept (used to calculate potential fields).
* **Scope:** The structural scope or category identifier.
* **Depth:** The logical hierarchy or consequence depth.
* **Time:** Freshness tracking used for decay.
* **4D Coordinates (posX, posY, posZ, posW):** Location vectors mapping Matter (X), Kind (Y), Energy (Z), and Age (W).

The manifold is a living geometry. A conformal factor $\phi$ (derived from local density) continuously warps distances: $g_{ij} = e^{2\phi} \delta_{ij}$. Ricci flow ($\partial g / \partial t = -2,\mathrm{Ric}$) flattens high-curvature zones over time, preventing runaway attractor sinks. Topological events (component births/deaths, $H_1$ loop appearances) are detected every 100 ticks and drive the dream/expansion cycle toward underexplored regions.

### Semantic Resonance Propagation

Deductive inference propagates activation values across coordinates. The potential field equations and spatial indexes dictate signal propagation between precepts:

* **Conjunction (AND):** Overlapping semantic scopes amplify local density values.
* **Inversion (NOT):** Negation is represented by complementary coordinates, inducing localized potential repulsion fields (forces pointing away from the precept).
* **Geometric Lensing:** Identity transformations (e.g. "is", "are") and quantifiers project coordinates, warping the distance metric to connect disjoint semantic regions.
* **Conformal Potential:** The scalar potential $\phi$ at each point scales the metric as $g_{ij} = e^{2\phi} \delta_{ij}$. Force is $F = -\nabla\phi$; scalar curvature is $R = -6,e^{-2\phi}!\left(\nabla^2\phi + |\nabla\phi|^2\right)$.

### Geodesic Pathfinding

Deduction finds the optimal coordinate path (geodesic) connecting two precepts through the 4D potential field.

* **Path Relaxation:** The system uses gradient descent to optimize path coordinates toward high-density local minima while maintaining path continuity via spring forces.
* **Learned Christoffel Symbols:** The Traveler accumulates a $4 \times 4 \times 4$ correction tensor $\Delta\Gamma^{i}_{jk}$ from prior traversals.
  Each step applies the geodesic deviation $\sum_{j,k} \Delta\Gamma^{i}_{jk},v^j v^k$ to bias future paths toward historically successful routes.
* **Parallel Transport and Holonomy:** After each traversal the Traveler computes a $4 \times 4$ holonomy matrix (accumulated 4D plane rotations along the path). A high Frobenius norm $|H - I|_F$ signals a winding, creative inference rather than a straight deduction.
* **Time Monotonicity:** Node coordinates along the $W$ axis (Age) are constrained to be non-decreasing, ensuring sequential temporal order in derivations.
* **Trap Detection:** Sinks with high mass/density but near-zero entropy rate are identified as logic traps (representing circular definitions) and bypassed.
* **Path Homotopy / Analogy:** Two paths that are non-homotopic relative to a persistent $H_1$ generator are analogy candidates. A winding-number test around each generator atom produces a scalar $\mathrm{analogyScore} \in [0, 1]$.

### Skill Registry

The Mapper has an open-ended skill registry. A **skill** is an external behaviour the Mapper can elect to invoke when a query's manifold position is attracted to a capability precept. Skills are registered at boot time and elected at query time via potential-field proximity - no routing table needed.

```typescript
// Seed a capability precept at a characteristic manifold position
const preceptId = atomizer.getSymbolScope("SKILL:TRANSLATION", false);
system.operatorClass[preceptId] = OperatorClass.Capability;

// Register a handler
mapper.registerSkill(preceptId, async (ctx) => {
  const result = await translateText(ctx.query);
  return { answer: result, confidence: 0.9 };
});
```

As a skill is used successfully, `reinforcePath` increases the capability precept's density and mass, making its coordinates a stronger attractor for future query paths, resulting in geometry-based routing.

## Implementation Details

### Core Components

**Integral layer** (`src/core/integral/`)

* **Traveler** (`Traveler.ts`) - the single thinker. Owns perception (resonance propagation, Phase 0–7 pipeline), locomotion (geodesic traversal via gradient descent), learning (`learnCycle`), and autonomous motivation (`startAutonomy`). Tracks `position[4]`, accumulated `holonomyFrame`, and `deltaGamma[64]` (learned Christoffel correction). Entry point: `mapper.process(text)`.
* **System** (`System.ts`) - defines the DOPAT manifold, `TargetBuffer` enum (14 property buffers), `OperatorClass` enum (13 values: `None` through `Capability`). This is the topology schema.
* **Runtime** (`Runtime.ts`) - boot/wiring only. `Runtime.boot(opts)` creates System → Atomizer → Store → Traveler → Language → Skills. Exposes `rt.mapper`, `rt.language`, `rt.store`.
* **Topology** (`topology/`) - manifold geometry primitives. `HoTTKernel.ts` (homotopy-type-theory path combinators, $4 \times 4$ matrix ops), `Walkspace.ts` (geodesic walk space).
* **Skills** (`skills/`) - open-ended skill registry under subdirectory categories.
  * `language/Language.ts` - translation boundary. `ingest(text)` tokenizes/classifies; `ingestAssertion()` crystallizes facts; `express(ids)` decodes to text.
  * `language/WorkingMemory.ts` - short-term conversational context for reference resolution.
  * `code/Coder.ts` - `Synthesizer` class: collapses `Uint32Array` geodesic paths into executable TypeScript. Used internally by the Traveler perception pipeline.
  * `cognition/InquiryQueue.ts` - queues open-ended inquiry tasks for the Traveler.
  * `cognition/CognitiveLoop.ts` - back-compat shim; delegates to `Traveler.startAutonomy()`.

**Structural layer** (`src/core/structural/`)

* **Atomizers** (`atomizers/`) - convert language/signals to manifold coordinates. `SemanticAtomizer` uses 50D GloVe vectors projected to 192-dim (96 logic + 96 semantic) coordinates.
* **Memory Vault** (`Memory.ts`) - DuckDB-backed. `crystallizeProof()` saves proven paths with topological fingerprints; `checkInterferencePattern()` recalls them by topo-signature Jaccard similarity to skip re-computation. Persists Traveler session state (`traveler_sessions` table) and long-horizon $\phi$ (`session_phi` table).
* **Topology** - `PersistentHomology.ts` (Vietoris-Rips H₀/H₁ via GF(2) boundary reduction), `TopologyMapper.ts` (TDA Mapper nerve graph; fuzzy connectives `AND/OR/NOT/IMPLIES` over `ManifoldRegion`), `SessionSheaf.ts` (Čech H¹ over session overlaps).
* **Curvature / Geometry** - `Curvature.ts` (scalar curvature $R = -6,e^{-2\phi}(\nabla^2\phi + |\nabla\phi|^2)$; plugged into geodesic WGSL shader), `Singularity.ts` (detects and remediates $\phi$-singularities by atom splitting), `FrameworkIndex.ts` (three-tier union-find hierarchy; $O(1)$ active-atom filtering for path relaxation).
* **Manifold Infrastructure** - `ManifoldLifecycle.ts` (Triple Modular Redundancy, Ricci flow, topology ticks, singularity ticks, dream cycle), `ManifoldMetrics.ts`, `ManifoldReader.ts`, `Math.ts` (WebGPU `TensorMath_GPU` with CPU fallback).
* **Workers** (`workers/`) - off-thread: `manifold.worker.ts`, `seed.worker.ts`, `ast.worker.ts`, `wiki.worker.ts`, `AstSeedWorker.ts`.

### Computation

* **Hardware Acceleration:** Supports both SIMD-optimized CPU execution and GPU-accelerated matrix operations via WebGPU.
* **Self-Correction:** Implements Triple Modular Redundancy (TMR) for the free-list allocator (consisting of three redundant allocator tracks with majority voting) to ensure structural stability during intensive manifold allocations.

## Usage

```typescript
import Runtime from "./src/core/integral/Runtime";

const rt = await Runtime.boot({ atomizer: "semantic", db: "./data/repl.db" });

// Wire responses
rt.language.setRespond(text => console.log(text));

// All input goes through a single entry point
await rt.mapper.process("the sky is blue");        // assertion
await rt.mapper.process("What is the sky?");        // question → "blue"
await rt.mapper.process("yes");                     // positive feedback
await rt.mapper.process("function add(a, b) { return a + b; }");  // code ingestion
```

## Experimental Use Cases

This architecture is currently intended for exploring:

* **Signal Intelligence:** Mapping intent and logical relationships in RF environments.
* **Fuzzy Autonomous Reasoning:** Navigating complex rulesets where premises may be uncertain or noisy.
* **Topological Knowledge Bases:** Building reasoning systems that can merge and self-align through geometric resonance.

## Licensing

ModPAT is dual-licensed:

* **For the General Public:** Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE).
* **For Commercial Services:** If you wish to use this software to provide a service without being subject to AGPL-3.0 copyleft requirements, you must purchase a commercial license.

Please contact Oleksandr <hotdamnsucka@gmail.com> for commercial licensing inquiries.

***

MADE IN UKRAINE
