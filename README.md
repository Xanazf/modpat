# Modulated Praxis Attenuation Topology (ModPAT)

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
   git clone https://github.com/dopecodez/mpat.git
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

### 1. Contiguous Memory Manifold

The core state is managed in a contiguous system buffer (DMA) for high-performance calculations. Every logical "complex" is stored with the following physical properties:

* **Mass:** Representing the logical certainty or weight of the concept.
* **Scope:** A unique identifier mapped to the frequency domain.
* **4D Position:** Coordinates in Space (X, Y), Entropy (Z), and Time (W).

### 2. Spectral Logic (Based on Wave-Particle Duality)

The engine utilizes Fast Fourier Transforms (FFT) to process logical operations as interference patterns:

* **Constructive (AND):** Logical conjunctions result in signal amplification.
* **Normalized (OR):** Disjunctions act as a signal mixer, maintaining level without runaway amplification.
* **Phase Shift (NOT):** Negation is modeled as a 180-degree phase shift, creating destructive interference that repels logical pathing.

### 3. Geodesic Pathfinding

Deduction is performed by finding the "geodesic" (the shortest or most efficient path) through the manifold.

* **Relaxation:** The system uses gradient descent (in the context of differential geometry) to move path nodes toward high-density areas (logical attractors) while maintaining path smoothness through spring forces.
* **Trap Detection:** A self-review mechanism identifies "Logic Traps"—zones of high mass but low entropy that often indicate circular reasoning or logical distractors.

## Implementation Details

### Core Components

* **Resolver:** Manages the physics simulation of "precept" ( "particle" or "complex") propagation and "waveform collapse" into a final state.
* **Mapper:** Handles the iterative calculation of geodesic routes between concepts.
* **Atomizers:** Convert natural language (via NLP) or RF signals (via spectral peaks) into physical precepts.
* **Memory Vault:** Uses DuckDB to "crystallize" proven logical paths, allowing them to be recalled by their topological signature without re-running the simulation.

### Computation

* **Hardware Acceleration:** Supports both SIMD-optimized CPU execution and GPU-accelerated matrix operations via WebGPU.
* **Self-Correction:** Implements Triple Modular Redundancy (TMR) for critical system pointers to ensure stability during intensive topological shifts.

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
