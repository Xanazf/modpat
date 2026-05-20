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
   cd mpat
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

### 1. The Gravity of Operators

The system is built on the premise that operators (relationships) are the primary structural elements, while variables are secondary.

* **Operators as Attractors:** Logic operators such as `AND`, `OR`, and `IMPLIES` are treated as "massive" points of attraction within a coordinate system. They define the "gravity" of the local logical space.
* **Variable Abstraction:** Variables (the atoms of a statement) are treated as low-mass particles that cluster around these operators. This allows the system to identify logical patterns based on their topological shape rather than their specific symbolic labels.

### 2. Topology

Rules and axioms are not stored as a list, but as a topography.

* **Pathways:** A logical rule like `A implies B` creates a specific gradient or pathway between coordinates in the manifold.
* **Axiomatic Templates:** By abstracting variables into generic placeholders, the system generates universal signatures. This allows a rule learned in one context to be recognized in another if the topological "shape" of the statement matches.

## System Architecture

The integral layer has exactly two conceptual residents:

* **System** — the world. Precepts are terrain. The topology encodes everything the system knows.
* **Mapper** — the traveler. It observes the terrain (perception), moves through it (locomotion), and leaves trails (learning). Thinking IS movement. `mapper.process(text)` is the single entry point for all input.

A thin **Language** layer sits at the boundary: it converts raw text into System precepts (ingest direction) and decodes a Mapper terminal position back into text (express direction). This is translation, not thinking.

```
Natural language → Language.ingest() → Manifold (DOPAT) → Mapper.perceive() + traverse()
                         ↑                                          ↕
                  Language.express() ←-- Mapper.process() --  Memory Vault (DuckDB)
```

### Contiguous Memory Manifold (DOPAT)

The core state is managed in a contiguous system buffer for high-performance topological calculations. Every logical "precept" is stored as a physical entity within a dual-layer manifold with the following properties:

* **Matter (Mass):** The logical importance or content density of the precept.
* **Kind (Scope):** The structural reach or category identifier.
* **Energy (Depth):** The logical potential or consequence depth.
* **Age (Time):** The temporal state or context within the logical loom.
* **4D Position:** Coordinates in Matter (X), Kind (Y), Energy (Z), and Age (W).

### Spectral Logic (Resonance Propagation)

The engine models logical operations as energy vibrations propagating through a manifold. This is implemented via a Transfer Matrix (W) that defines the conductivity of logic between precepts:

* **Constructive Interference (AND):** Logical conjunctions result in signal amplification through shared semantic scopes.
* **Destructive Interference (NOT):** Negation is modeled as a 180-degree phase shift, creating repelling potential fields.
* **Gravitational Lensing:** Identity shifts (e.g., "is", "are") and quantifiers act as lenses that bend the logical path, allowing energy to bypass structural operators.

### Geodesic Pathfinding

Deduction is performed by finding the "geodesic" (the shortest logical path) through the 4D manifold potential field.

* **Iterative Relaxation:** The system uses gradient descent to move path nodes toward high-density logic attractors while maintaining path smoothness through simulated spring forces.
* **Monotonic Age Traversal:** Paths are constrained by the Temporal Anisotropy, ensuring temporal consistency in derivations.
* **Trap Detection:** A self-review mechanism identifies "Logic Traps" — zones of high mass but low entropy that indicate circular reasoning or semantic dead-ends.

### Skill Registry

The Mapper has an open-ended skill registry. A **skill** is an external behaviour the Mapper can elect to invoke when a query's manifold position is attracted to a capability precept. Skills are registered at boot time and elected at query time via potential-field proximity — no routing table needed.

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

As a skill is used successfully, `reinforcePath` grows the capability precept's mass, making it a stronger attractor for similar future queries — routing by physics, not code.

## Implementation Details

### Core Components

* **Mapper** (`src/core/integral/Mapper.ts`) — the single thinker. Owns perception (resonance propagation, Phase 0–7 pipeline), locomotion (geodesic traversal via gradient descent), learning (`learnCycle`), and autonomous motivation (`startAutonomy`). The entry point for all input is `mapper.process(text)`.
* **Language** (`src/core/integral/language/Language.ts`) — the translation boundary. `ingest(text)` tokenizes and classifies input; `ingestAssertion()` crystallizes declarative facts into the vault; `express(ids)` decodes precept sequences back to text.
* **System** (`src/core/integral/System.ts`) — defines the DOPAT manifold, `TargetBuffer` enum (14 property buffers), `OperatorClass` enum (12 types). This is the topology schema.
* **Skills** (`src/core/integral/skills/`) — open-ended skill registry. `Coder.ts` registers the code-synthesis handler.
* **Synthesizer** (`src/core/integral/Coder.ts`) — collapses `Uint32Array` geodesic paths into executable TypeScript code. Used internally by the Mapper perception pipeline.
* **Atomizers** (`src/core/structural/atomizers/`) — convert natural language or external signals into atomic logical quanta, mapping them to specific coordinates in the manifold. `SemanticAtomizer` uses 50D GloVe vectors projected to 192-dim manifold coordinates.
* **Memory Vault** (`src/core/structural/Memory.ts`) — uses DuckDB to crystallize proven logical paths, allowing them to be recalled by their topological signature.
* **Runtime** (`src/core/integral/Runtime.ts`) — boot/wiring only. `Runtime.boot(opts)` creates System → Atomizer → Store → Mapper → Language → Skills. Exposes `rt.mapper`, `rt.language`, `rt.store`.

### Computation

* **Hardware Acceleration:** Supports both SIMD-optimized CPU execution and GPU-accelerated matrix operations via WebGPU.
* **Self-Correction:** Implements Triple Modular Redundancy (TMR) for critical system pointers to ensure stability during intensive topological shifts.

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
