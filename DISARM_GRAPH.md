# Classification and Detection of Malicious Influence Patterns via Graph Neural Networks

## Executive Summary

In threat intelligence, cognitive security, and data science, a **malicious influence pattern** is formally classified using standardized taxonomy frameworks and multi-dimensional feature vectors that evaluate coordinated activity across network, temporal, semantic, and technical domains.

An isolated piece of data (such as a single biased post or synthetic image) rarely constitutes an influence pattern on its own. Classification requires evaluating a **composite payload and behavioral signature** across multiple operational layers.

---

## 1. Standard Taxonomy & Classification Frameworks

Threat intelligence relies on formal taxonomy models to categorize information operations in a manner similar to cybersecurity threat detection:

### 1.1 DISARM Framework (Disinformation Analysis and Risk Management)
Modeled directly on the MITRE ATT&CK taxonomy, DISARM categorizes adversary Tactics, Techniques, and Procedures (TTPs) across campaign lifecycle phases:
* **Plan & Prepare:** Persona development, platform selection, infrastructure setup.
* **Execute & Distribute:** Botnet deployment, astroturfing, microtargeting, cross-platform seeding.
* **Assess & Adapt:** Measuring cognitive impact, evading platform moderation algorithms, domain hopping.

### 1.2 ABCDE Framework
Categorizes threat vectors across five specific axes:
* **Actor:** The initiating, sponsoring, or proxy entity behind the operation.
* **Behaviour:** The operational mechanics (e.g., automation, impersonation, coordinated amplification).
* **Content:** Narrative structures, deception techniques, deepfakes, or psychological hooks.
* **Degree:** Reach, velocity, scale, and cross-platform dispersion metrics.
* **Effect:** Measurable societal, political, or institutional impact.

### 1.3 Coordinated Inauthentic Behavior (CIB)
A behavioral classification model used in platform security that focuses strictly on network orchestration—evaluating whether entities act in concert using deceptive identities or automated scripts to manipulate target environments, regardless of topic or content validity.

---

## 2. Multi-Dimensional Feature Vectors

To detect and classify a dataset $D$ as a malicious influence pattern, processing pipelines extract a multi-layered feature vector across four primary domains:

### 2.1 Network & Structural Topology
* **Anomalous Clustering Coefficients:** Unusually dense interaction subgraphs (retweets, replies, cross-links) within a tightly connected subset of nodes relative to the broader network topology.
* **Astroturfing Hubs:** Nodes exhibiting severe degree asymmetry (high out-degree for shares/mentions, minimal organic in-degree).
* **Cross-Platform Seeding Trajectories:** Data moving sequentially through predictable propagation routes (e.g., fringe message boards $\rightarrow$ automated aggregators $\rightarrow$ hyper-partisan relay nodes $\rightarrow$ mainstream feeds).

### 2.2 Temporal Mechanics
* **Low Temporal Entropy:** Synchronized bursts of posting activity from non-relational endpoints occurring within tight millisecond or second windows.
* **Creation Epoch Alignment:** Networks of accounts created during the same narrow timeframe that remain dormant until simultaneous activation for a specific campaign phase.
* **Uniform Reaction Latency:** Statistically improbable delay distributions across geographically or topographically separated nodes.

### 2.3 Semantic & Payload Artifacts
* **Lexical Duplication ("Copypasta"):** Verbatim or near-identical text blocks distributed across disparate channels.
* **Narrative Vector Embeddings:** High cosine similarity among dense text vector embeddings across independent accounts, indicating shared messaging briefs or automated rewrites using large language models.
* **Affective Valence Exploitation:** High concentrations of emotional activation triggers (moral outrage, fear responses) designed to bypass analytical filtering and maximize viral re-transmission.

### 2.4 Technical & Infrastructure Artifacts
* **Fingerprint Collisions:** Overlapping User-Agent strings, canvas fingerprints, or shared proxy/VPN exit subnets across supposedly distinct identities.
* **Programmatic Handle Structures:** Identical algorithmic naming conventions in account creation metadata (e.g., regular expressions matching randomized alphanumeric tails).

---

## 3. Mathematical Classification Logic

Automated detection systems model input data as a heterogeneous graph $G = (V, E, X)$, where $V$ represents nodes (actors/endpoints), $E$ represents interaction edges, and $X$ represents node feature matrices (content embeddings, metadata).

A composite threat function $S(D)$ calculates the total threat score:

$$S(D) = w_n \cdot \text{NetworkCoordination}(G) + w_t \cdot \text{TemporalAnomaly}(T) + w_s \cdot \text{SemanticAlignment}(X) + w_i \cdot \text{InfraOverlap}(I)$$

Where:
* $w_n, w_t, w_s, w_i \in [0, 1]$ are assigned weights based on threat model priors ($\sum w = 1$).
* Classification as a **Malicious Influence Pattern** triggers when $S(D) \ge \tau$, where $\tau$ is a calibrated confidence threshold.

---

## 4. Graph Neural Networks (GNNs) for Coordinated Subgraph Detection

Graph Neural Networks model and detect coordinated inauthentic subgraphs by transforming social interactions into a **Heterogeneous Information Network (HIN)**, aggregating structural and behavioral features through message passing, and applying anomaly-aware filtering.

### 4.1 Heterogeneous Information Network (HIN) Formulation
Social media platforms are modeled as a heterogeneous graph $G = (V, E, \mathcal{T}_v, \mathcal{T}_e)$, where:
* $V$ is the set of multi-modal nodes (users, posts, URLs, IP subnets, hashtags), mapped by $\phi: V \rightarrow \mathcal{T}_v$.
* $E$ is the set of typed directed edges representing relationships (e.g., `retweeted_by`, `co_posted_within_100ms`, `shared_device`), mapped by $\psi: E \rightarrow \mathcal{T}_e$.
* $X_t \in \mathbb{R}^{|V_t| \times d_t}$ represents the initial feature matrix for node type $t \in \mathcal{T}_v$.

### 4.2 Relational Message Passing & Aggregation
To capture high-order relational topologies, Relational Graph Attention Networks (R-GAT) or Relational Graph Convolutional Networks (R-GCN) aggregate feature representations across distinct relation types.

For a target node $v \in V$, the hidden state vector $h_v^{(l+1)}$ at layer $l+1$ is updated via relation-specific transformations:

$$h_v^{(l+1)} = \sigma \left( W_{\text{self}}^{(l)} h_v^{(l)} + \sum_{r \in \mathcal{T}_e} \sum_{u \in \mathcal{N}_v^r} \alpha_{vu}^{(r)} W_r^{(l)} h_u^{(l)} \right)$$

Where:
* $W_r^{(l)} \in \mathbb{R}^{d_{l+1} \times d_l}$ is a trainable transformation matrix specific to relation type $r$.
* $\mathcal{N}_v^r$ is the set of neighbors of node $v$ under relation $r$.
* $\sigma(\cdot)$ is a non-linear activation function (e.g., LeakyReLU or ELU).
* $\alpha_{vu}^{(r)}$ is the relation-specific attention weight measuring the influence of neighbor $u$ on $v$:

$$\alpha_{vu}^{(r)} = \frac{\exp \left( \text{LeakyReLU} \left( a_r^T [ W_r h_v \parallel W_r h_u ] \right) \right)}{\sum_{k \in \mathcal{N}_v^r} \exp \left( \text{LeakyReLU} \left( a_r^T [ W_r h_v \parallel W_r h_k ] \right) \right)}$$

### 4.3 Mitigating Adversarial Camouflage (Heterophily)
Coordinated influence networks attempt to evade detection by injecting "camouflage" links—connecting malicious accounts to benign high-reputation nodes. Standard GNN aggregators suffer from over-smoothing in these heterophilous regimes.

#### A. Adaptive Neighbor Selection (CARE-GNN)
Frameworks like CARE-GNN calculate a dynamic label similarity threshold $p_r^{(l)} \in [0, 1]$ for relation $r$ at layer $l$:

$$S^{(l)}(v, u) = \sigma \left( \mathbf{w}_{\text{sim}}^T \left| h_v^{(l)} - h_u^{(l)} \right| \right)$$

Edges where $S^{(l)}(v, u) < p_r^{(l)}$ are pruned during aggregation, preventing benign node features from contaminating malicious cluster representations.

#### B. Spectral Wavelet Filtering (BWGNN)
Beta Wavelet Graph Neural Networks (BWGNN) model graph signals in the spectral domain using the normalized graph Laplacian $L = I - D^{-1/2} A D^{-1/2}$. Using a bank of Beta wavelet filters $g_{p, q}(\Lambda)$, the model isolates high-frequency signal components:

$$H_{\text{out}} = \sum_{k} g_{p, q}(\lambda_k) U^T X$$

Because coordinated bot networks introduce localized, high-density anomalies that trigger sharp variations in local graph signals, high-pass and band-pass spectral filters retain anomalous coordinated structures while suppressing smooth background traffic.

### 4.4 Subgraph Extraction & Anomaly Scoring

#### Unsupervised Graph Contrastive Learning (GCL)
When labeled datasets are unavailable, GCL maximizes mutual information between local subgraphs $S_i$ and global graph summaries $g$. The InfoNCE loss function contrasts positive augmented views of the same subgraph against negative pairs:

$$\mathcal{L}_{\text{GCL}} = -\sum_{i=1}^N \log \frac{\exp \left( \text{sim}(z_i, z_i') / \tau \right)}{\sum_{j=1}^N \exp \left( \text{sim}(z_i, z_j') / \tau \right)}$$

#### Density Optimization Function
Target subgraphs $S^* \subset V$ are extracted by evaluating the localized edge-to-node density ratio combined with feature similarity:

$$D(S) = \frac{\sum_{u, v \in S} A_{uv} \cdot \cos(h_u^{(L)}, h_v^{(L)})}{|S|^\gamma}$$

Where $\gamma \in (0, 1]$ controls for cluster size bias. Subgraphs with $D(S) \ge \theta$ are identified as distinct, coordinated malicious influence units.

---

## 5. TypeScript Implementation: Heterogeneous R-GCN Layer with Camouflage Filtering

Below is an exhaustive TypeScript implementation of a Heterogeneous Relational Graph Convolutional Network (R-GCN) message-passing layer equipped with relation-specific transformations, multi-head attention mechanisms, and CARE-GNN adaptive camouflage filtering.

```typescript
/**
 * Types & Interfaces for Heterogeneous Graph Representation
 */

export type NodeType = 'USER' | 'POST' | 'IP_SUBNET' | 'HASHTAG';
export type RelationType = 'RETWEETED' | 'CO_POSTED_BURST' | 'SHARED_IP' | 'USED_HASHTAG';

export interface Node {
  id: string;
  type: NodeType;
  features: number[]; // Initial node feature vector x_v
}

export interface Edge {
  sourceId: string;
  targetId: string;
  relation: RelationType;
  weight?: number;
}

export interface HeterogeneousGraph {
  nodes: Map<string, Node>;
  edges: Edge[];
}

export interface RGCNLayerConfig {
  inFeatures: number;
  outFeatures: number;
  relations: RelationType[];
  useCamouflageFiltering: boolean;
  similarityThreshold: number; // p_r threshold for gating camouflage edges
}

/**
 * Matrix & Vector Operations Helper Class
 */
export class VectorOps {
  static dot(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  static add(a: number[], b: number[]): number[] {
    return a.map((val, idx) => val + b[idx]);
  }

  static subtract(a: number[], b: number[]): number[] {
    return a.map((val, idx) => val - b[idx]);
  }

  static absDifference(a: number[], b: number[]): number[] {
    return a.map((val, idx) => Math.abs(val - b[idx]));
  }

  static scale(v: number[], scalar: number): number[] {
    return v.map(val => val * scalar);
  }

  static matVecMul(matrix: number[][], vec: number[]): number[] {
    const rows = matrix.length;
    const cols = matrix[0].length;
    if (vec.length !== cols) {
      throw new Error(`Dimension mismatch: Matrix cols (${cols}) != Vector length (${vec.length})`);
    }
    const result = new Array(rows).fill(0);
    for (let i = 0; i < rows; i++) {
      let sum = 0;
      for (let j = 0; j < cols; j++) {
        sum += matrix[i][j] * vec[j];
      }
      result[i] = sum;
    }
    return result;
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    const dotProd = VectorOps.dot(a, b);
    const normA = Math.sqrt(VectorOps.dot(a, a));
    const normB = Math.sqrt(VectorOps.dot(b, b));
    if (normA === 0 || normB === 0) return 0;
    return dotProd / (normA * normB);
  }

  static leakyRelu(x: number, alpha: number = 0.2): number {
    return x > 0 ? x : alpha * x;
  }

  static sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }
}

/**
 * Heterogeneous Relational Graph Convolutional Network (R-GCN) Layer
 * Implements: h_v^(l+1) = \sigma( W_self h_v^(l) + \sum_{r} \sum_{u \in N_v^r} \alpha_{vu}^{(r)} W_r h_u^(l) )
 * Includes Adaptive Similarity Filtering for Camouflage Link Pruning
 */
export class RelationalGCNLayer {
  private config: RGCNLayerConfig;
  private weightMatrices: Map<RelationType, number[][]>; // W_r for each relation
  private selfWeightMatrix: number[][]; // W_self
  private attentionVectors: Map<RelationType, number[]>; // a_r for attention
  private simWeightVector: number[]; // w_sim for camouflage similarity calculation

  constructor(config: RGCNLayerConfig) {
    this.config = config;
    this.weightMatrices = new Map();
    this.attentionVectors = new Map();

    // Initialize trainable parameters deterministically / pseudo-randomly
    for (const rel of config.relations) {
      this.weightMatrices.set(rel, this.initMatrix(config.outFeatures, config.inFeatures));
      this.attentionVectors.set(rel, this.initVector(config.outFeatures * 2));
    }
    this.selfWeightMatrix = this.initMatrix(config.outFeatures, config.inFeatures);
    this.simWeightVector = this.initVector(config.inFeatures);
  }

  private initMatrix(rows: number, cols: number): number[][] {
    const scale = Math.sqrt(2.0 / (rows + cols));
    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => Math.sin(r * cols + c + 1) * scale)
    );
  }

  private initVector(size: number): number[] {
    return Array.from({ length: size }, (_, i) => Math.cos(i + 1) * 0.1);
  }

  /**
   * Computes edge similarity score to filter adversarial camouflage (CARE-GNN mechanism)
   * S(v, u) = \sigma( w_sim^T |h_v - h_u| )
   */
  private computeSimilarity(h_v: number[], h_u: number[]): number {
    const diff = VectorOps.absDifference(h_v, h_u);
    const score = VectorOps.dot(this.simWeightVector, diff);
    return VectorOps.sigmoid(score);
  }

  /**
   * Computes relation-specific attention weight \alpha_{vu}^{(r)}
   */
  private computeAttention(
    rel: RelationType,
    transformed_v: number[],
    transformed_u: number[]
  ): number {
    const concat = [...transformed_v, ...transformed_u];
    const attnVec = this.attentionVectors.get(rel)!;
    const rawAttn = VectorOps.dot(attnVec, concat);
    return Math.exp(VectorOps.leakyRelu(rawAttn));
  }

  /**
   * Executes Message Passing across heterogeneous relations
   * @param graph Input Heterogeneous Graph
   * @param currentEmbeddings Map of node ID to feature vector h_v^(l)
   * @returns Updated embeddings Map of node ID to h_v^(l+1)
   */
  public forward(
    graph: HeterogeneousGraph,
    currentEmbeddings: Map<string, number[]>
  ): Map<string, number[]> {
    const nextEmbeddings = new Map<string, number[]>();

    // Step 1: Pre-transform representations for each relation
    const transformedByRel = new Map<RelationType, Map<string, number[]>>();
    for (const rel of this.config.relations) {
      const W_r = this.weightMatrices.get(rel)!;
      const relMap = new Map<string, number[]>();
      for (const [nodeId, feat] of currentEmbeddings.entries()) {
        relMap.set(nodeId, VectorOps.matVecMul(W_r, feat));
      }
      transformedByRel.set(rel, relMap);
    }

    // Step 2: Aggregate messages for each target node
    for (const [nodeId, targetNode] of graph.nodes.entries()) {
      const h_v = currentEmbeddings.get(nodeId)!;

      // Self-loop transformation: W_self * h_v
      let aggregatedMessage = VectorOps.matVecMul(this.selfWeightMatrix, h_v);

      // Iterate through relations
      for (const rel of this.config.relations) {
        const transformedNodes = transformedByRel.get(rel)!;
        const targetTransformed = transformedNodes.get(nodeId)!;

        // Find incoming edges under relation rel
        const incomingEdges = graph.edges.filter(
          e => e.targetId === nodeId && e.relation === rel
        );

        if (incomingEdges.length === 0) continue;

        let relationSum = new Array(this.config.outFeatures).fill(0);
        let totalAttentionWeight = 0;

        for (const edge of incomingEdges) {
          const neighborId = edge.sourceId;
          const h_u = currentEmbeddings.get(neighborId);
          if (!h_u) continue;

          // Camouflage Filtering Gate (CARE-GNN)
          if (this.config.useCamouflageFiltering) {
            const simScore = this.computeSimilarity(h_v, h_u);
            if (simScore < this.config.similarityThreshold) {
              // Prune message from camouflage link
              continue;
            }
          }

          const neighborTransformed = transformedNodes.get(neighborId)!;
          const unnormAttn = this.computeAttention(rel, targetTransformed, neighborTransformed);

          const scaledMsg = VectorOps.scale(neighborTransformed, unnormAttn);
          relationSum = VectorOps.add(relationSum, scaledMsg);
          totalAttentionWeight += unnormAttn;
        }

        // Normalize attention across relation neighborhood
        if (totalAttentionWeight > 0) {
          const normalizedRelMsg = VectorOps.scale(relationSum, 1.0 / totalAttentionWeight);
          aggregatedMessage = VectorOps.add(aggregatedMessage, normalizedRelMsg);
        }
      }

      // Non-linear Activation (LeakyReLU)
      const activatedMessage = aggregatedMessage.map(val => VectorOps.leakyRelu(val));
      nextEmbeddings.set(nodeId, activatedMessage);
    }

    return nextEmbeddings;
  }
}

/**
 * Coordinated Subgraph Detection & Anomaly Evaluator
 */
export class CoordinatedSubgraphDetector {
  /**
   * Calculates Subgraph Density Score D(S) = \frac{\sum A_uv \cdot cos(h_u, h_v)}{|S|^\gamma}
   */
  public static calculateSubgraphDensity(
    subgraphNodeIds: string[],
    graph: HeterogeneousGraph,
    embeddings: Map<string, number[]>,
    gamma: number = 0.8
  ): number {
    const nodeSet = new Set(subgraphNodeIds);
    let edgeSimilaritySum = 0;

    for (const edge of graph.edges) {
      if (nodeSet.has(edge.sourceId) && nodeSet.has(edge.targetId)) {
        const embU = embeddings.get(edge.sourceId);
        const embV = embeddings.get(edge.targetId);
        if (embU && embV) {
          edgeSimilaritySum += VectorOps.cosineSimilarity(embU, embV);
        }
      }
    }

    const sizePenalty = Math.pow(subgraphNodeIds.length, gamma);
    return sizePenalty > 0 ? edgeSimilaritySum / sizePenalty : 0;
  }
}

// Example Execution Driver
export function runDetectionPipeline(): void {
  const nodes = new Map<string, Node>([
    ['user_1', { id: 'user_1', type: 'USER', features: [0.9, 0.1, 0.85, 0.05] }],
    ['user_2', { id: 'user_2', type: 'USER', features: [0.88, 0.12, 0.82, 0.08] }],
    ['user_3', { id: 'user_3', type: 'USER', features: [0.1, 0.9, 0.05, 0.95] }], // Benign camouflage target
    ['ip_1', { id: 'ip_1', type: 'IP_SUBNET', features: [0.95, 0.05, 0.9, 0.1] }],
  ]);

  const edges: Edge[] = [
    { sourceId: 'user_1', targetId: 'user_2', relation: 'CO_POSTED_BURST' },
    { sourceId: 'user_2', targetId: 'user_1', relation: 'CO_POSTED_BURST' },
    { sourceId: 'ip_1', targetId: 'user_1', relation: 'SHARED_IP' },
    { sourceId: 'ip_1', targetId: 'user_2', relation: 'SHARED_IP' },
    { sourceId: 'user_1', targetId: 'user_3', relation: 'RETWEETED' }, // Camouflage edge
  ];

  const graph: HeterogeneousGraph = { nodes, edges };

  const initialEmbeddings = new Map<string, number[]>();
  for (const [id, node] of nodes.entries()) {
    initialEmbeddings.set(id, node.features);
  }

  const layer = new RelationalGCNLayer({
    inFeatures: 4,
    outFeatures: 4,
    relations: ['RETWEETED', 'CO_POSTED_BURST', 'SHARED_IP'],
    useCamouflageFiltering: true,
    similarityThreshold: 0.5,
  });

  const updatedEmbeddings = layer.forward(graph, initialEmbeddings);

  const clusterDensity = CoordinatedSubgraphDetector.calculateSubgraphDensity(
    ['user_1', 'user_2'],
    graph,
    updatedEmbeddings
  );

  console.log('R-GCN Processing Complete.');
  console.log(`Coordinated Subgraph Density Score D(S): ${clusterDensity.toFixed(4)}`);
}
```
