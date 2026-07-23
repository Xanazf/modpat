/**
 * Anisotropic-metric sweep - is the manifold's uniform Euclidean metric over the
 * four axes (Matter X, Kind Y, Energy Z, Age W) actually justified?
 *
 * MapFidelity/ClosedWorldFidelity score a placement with the RAW metric
 *   d = sqrt(dx^2 + dy^2 + dz^2 + dw^2)
 * with a standing comment that "no per-axis renormalization is applied" because
 * "the placer produces coherent axis scales". But placeGraph() puts X/Y/Z in
 * graph-distance units (SMACOF) and W on the number line (numeric * 0.1) - two
 * qualitatively different rulers added in quadrature. dimensions_theory.md §2
 * makes the falsifiable claim that this is a category error ("you cannot add
 * meters to seconds"); the Minkowski metric gives time a different weight/sign
 * for exactly this reason.
 *
 * This sweep tests that claim empirically, WITHOUT touching production code:
 *   - to score a placement under metric weights (wx,wy,wz,ww), scale each axis by
 *     sqrt(weight) and hand the scaled placement to the UNMODIFIED production
 *     scorers - since sqrt(Σ wi·di^2) = euclid(√wi·di), this is the exact weighted
 *     metric, evaluated by the real mapFidelity / closedWorldFidelity.
 *   - only RELATIVE axis weights matter: pearson (a correlation) and separation
 *     (a ratio) are invariant under global scaling. So we hold X=Y=Z=1 and sweep
 *     the W weight, then run a drop-one ablation per axis.
 *
 * Reading the result:
 *   - If pearson/separation/closed-world fidelity are FLAT across the W sweep, the
 *     uniform metric is justified for that corpus (W carries no recoverable
 *     structure at any weight) - earned, with evidence, not assumed.
 *   - If they MOVE, the axis weights are load-bearing and the unweighted metric is
 *     leaving fidelity on the table (or the implicit numberLineScale=0.1 is the
 *     wrong weight). Either way the "coherent axis scales" assumption is falsified.
 *
 * Pure module: GroundGraph + Placement only, no System / DB / GPU / embeddings.
 * Run: tsx scripts/dev/anisotropic_metric_sweep.ts
 */

import { closedWorldFidelity } from "@core_s/grounding/ClosedWorldFidelity";
import {
  bfsHopDistances,
  undirectedAdjacency,
} from "@core_s/grounding/GroundGraph";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import { mapFidelity } from "@core_s/grounding/MapFidelity";
import { placeGraph } from "@core_s/grounding/StructuralGrounding";

type Weights = readonly [number, number, number, number]; // [wx, wy, wz, ww]

const AXES = ["X(matter)", "Y(kind)", "Z(energy)", "W(age)"] as const;

interface Corpus {
  name: string;
  statements: string[];
}

// A spread of corpora: W-heavy (arithmetic literals populate the number line),
// Reference-edged (taxonomy/KB - closed-world fidelity is defined), and spatial
// (implication chain - W is empty, so it is the negative control).
const CORPORA: Corpus[] = [
  {
    name: "arithmetic (W-heavy)",
    statements: [
      "3 + 4 = 7",
      "1 + 2 = 3",
      "5 + 2 = 7",
      "2 + 5 = 7",
      "6 - 2 = 4",
      "4 + 3 = 7",
      "1 + 3 = 4",
      "2 + 2 = 4",
      "5 + 5 = 10",
      "8 - 3 = 5",
    ],
  },
  {
    name: "taxonomy KB (Reference)",
    statements: [
      "all squares are rectangles",
      "all rectangles are quadrilaterals",
      "all quadrilaterals are polygons",
      "all polygons are shapes",
      "all triangles are polygons",
      "all circles are shapes",
      "figure1 is a square",
      "figure2 is a triangle",
    ],
  },
  {
    name: "mixed KB (Ref + arith)",
    statements: [
      "all squares are rectangles",
      "all rectangles are quadrilaterals",
      "all quadrilaterals are polygons",
      "figure1 is a square",
      "3 + 4 = 7",
      "1 + 2 = 3",
      "2 + 2 = 4",
      "5 + 2 = 7",
    ],
  },
  {
    name: "implication chain (W-empty)",
    statements: [
      "p implies q",
      "q implies r",
      "r implies s",
      "s implies t",
      "t implies u",
      "u implies v",
      "v implies w",
    ],
  },
];

const W_SWEEP: number[] = [0, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16];

/** Scale each axis by sqrt(weight) so the Euclidean scorer sees the weighted metric. */
function reweight(p: Grounding.Placement, w: Weights): Grounding.Placement {
  const n = p.x.length;
  const s = w.map(Math.sqrt) as unknown as Weights;
  const out: Grounding.Placement = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: p.mass,
  };
  for (let i = 0; i < n; i++) {
    out.x[i] = p.x[i] * s[0];
    out.y[i] = p.y[i] * s[1];
    out.z[i] = p.z[i] * s[2];
    out.w[i] = p.w[i] * s[3];
  }
  return out;
}

interface Score {
  pearson: number;
  separation: number;
  /** Closed-world nearest-k recall, or null when the corpus has no Reference model. */
  cwFidelity: number | null;
}

function score(
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  w: Weights
): Score {
  const rp = reweight(p, w);
  const f = mapFidelity(g, rp, { seed: 1 });
  const cw = closedWorldFidelity(g, rp);
  return {
    pearson: f.pearson,
    separation: f.separation,
    cwFidelity: cw.total > 0 ? cw.fidelity : null,
  };
}

// -- Minkowski variant --------------------------------------------------------
// The positive-definite reweight above cannot represent an INDEFINITE signature:
// giving W a timelike (negative) sign means the interval s² = dx²+dy²+dz² - λ·dw²
// can be negative, and √(negative) is not a Euclidean distance - so the axis-
// scaling trick (and the production scorers) do not apply. This block hand-rolls
// the indefinite-metric fidelity, but VALIDATES itself against mapFidelity on the
// spacelike (all-+) case so the two are the same measurement where they overlap.
//
// Signed interval -> a monotone "distance" via signed-sqrt: sign(s²)·√|s²|. This
// equals ordinary Euclidean distance whenever s² ≥ 0, so the spacelike branch is
// a faithful re-derivation of the production metric; the timelike branch extends
// it to causal (negative-interval) separations the document's §2/Minkowski point
// is about. Adjacent pairs going TIMELIKE = the graph edge reads as a causal link.

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    num += da * db;
    va += da * da;
    vb += db * db;
  }
  const den = Math.sqrt(va * vb);
  return den > 1e-12 ? num / den : 0;
}

interface MinkScore {
  /** Pearson r between graph hop-distance and the signed Minkowski distance. */
  pearson: number;
  /** Fraction of graph-adjacent pairs whose interval is timelike (s² < 0). */
  timelikeAdj: number;
  /** Fraction of random non-adjacent pairs that are timelike. */
  timelikeNon: number;
}

/**
 * sign = +1 -> W spacelike (positive-definite; reproduces the Euclidean scorer).
 * sign = -1 -> W timelike  (Minkowski; the number line subtracts from the spatial
 * interval). X=Y=Z are always spacelike with weight 1.
 */
function minkowskiScore(
  g: Grounding.GroundGraph,
  p: Grounding.Placement,
  ww: number,
  sign: 1 | -1,
  seed = 1
): MinkScore {
  const n = g.nodes.length;
  const adj = undirectedAdjacency(g);

  const interval = (i: number, j: number): number => {
    const dx = p.x[i] - p.x[j];
    const dy = p.y[i] - p.y[j];
    const dz = p.z[i] - p.z[j];
    const dw = p.w[i] - p.w[j];
    return dx * dx + dy * dy + dz * dz + sign * ww * dw * dw;
  };
  const sdist = (i: number, j: number): number => {
    const s = interval(i, j);
    return Math.sign(s) * Math.sqrt(Math.abs(s));
  };

  // Correlation over the same strided-BFS sampling mapFidelity uses.
  const gd: number[] = [];
  const md: number[] = [];
  const stride = Math.max(1, Math.floor(n / 64));
  for (let src = 0; src < n && gd.length < 4000; src += stride) {
    const hop = bfsHopDistances(src, adj);
    for (let j = src + 1; j < n && gd.length < 4000; j++) {
      const d = hop[j];
      if (!Number.isFinite(d) || d === 0) continue;
      gd.push(d);
      md.push(sdist(src, j));
    }
  }

  // Timelike fraction: adjacent (edges) vs random non-adjacent pairs.
  const edgeKey = new Set<number>();
  let adjTime = 0;
  let adjCount = 0;
  for (const e of g.edges) {
    if (e.from === e.to) continue;
    const lo = Math.min(e.from, e.to);
    const hi = Math.max(e.from, e.to);
    edgeKey.add(lo * n + hi);
    if (interval(e.from, e.to) < 0) adjTime++;
    adjCount++;
  }
  const rng = makeRng(seed);
  let nonTime = 0;
  let nonCount = 0;
  for (let s = 0; s < 2000; s++) {
    const i = Math.floor(rng() * n);
    const j = Math.floor(rng() * n);
    if (i === j) continue;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    if (edgeKey.has(lo * n + hi)) continue;
    if (interval(i, j) < 0) nonTime++;
    nonCount++;
  }

  return {
    pearson: pearson(gd, md),
    timelikeAdj: adjCount > 0 ? adjTime / adjCount : 0,
    timelikeNon: nonCount > 0 ? nonTime / nonCount : 0,
  };
}

const fmt = (v: number | null, d = 3) =>
  v === null ? "  n/a" : v.toFixed(d).padStart(6);

function runCorpus(c: Corpus): void {
  const g = buildGraphFromLogic(c.statements);
  const p = placeGraph(g);
  const n = g.nodes.length;

  // How much of W is actually populated? (numberLineScale puts literals on it.)
  let wPopulated = 0;
  for (let i = 0; i < n; i++) if (Math.abs(p.w[i]) > 1e-12) wPopulated++;

  console.log(`\n=== ${c.name} ===`);
  console.log(
    `  nodes=${n}  edges=${g.edges.length}  W-populated=${wPopulated}/${n} ` +
      `(${((100 * wPopulated) / n).toFixed(0)}%)`
  );

  // -- W sweep (X=Y=Z=1, vary ww). ww=1 reproduces the production metric. -----
  console.log("\n  W-weight sweep (X=Y=Z=1):");
  console.log("    ww     pearson  separation  cwFidelity");
  const pear: number[] = [];
  const sep: number[] = [];
  for (const ww of W_SWEEP) {
    const s = score(g, p, [1, 1, 1, ww]);
    pear.push(s.pearson);
    sep.push(s.separation);
    const mark = ww === 1 ? "  <- production" : "";
    console.log(
      `   ${ww.toFixed(2).padStart(5)}   ${fmt(s.pearson)}    ${fmt(
        s.separation,
        2
      )}     ${fmt(s.cwFidelity)}${mark}`
    );
  }

  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  const dP = spread(pear);
  const dS = spread(sep);
  // Direction matters: ww=0 drops W, ww=1 is production. Does W *help* or *hurt*?
  const iDrop = W_SWEEP.indexOf(0);
  const iProd = W_SWEEP.indexOf(1);
  const pDrop = pear[iDrop];
  const pProd = pear[iProd];

  // -- Drop-one ablation: which axes are load-bearing for fidelity? -----------
  console.log("\n  drop-one-axis ablation (dropped weight=0, others=1):");
  console.log("    dropped      pearson  separation  cwFidelity");
  for (let a = 0; a < 4; a++) {
    const w: Weights = [
      a === 0 ? 0 : 1,
      a === 1 ? 0 : 1,
      a === 2 ? 0 : 1,
      a === 3 ? 0 : 1,
    ];
    const s = score(g, p, w);
    console.log(
      `    ${AXES[a].padEnd(11)}  ${fmt(s.pearson)}    ${fmt(
        s.separation,
        2
      )}     ${fmt(s.cwFidelity)}`
    );
  }

  // -- Verdict: is W inert, helpful, or harmful here? -------------------------
  const inert = dP < 0.01 && dS < 0.05;
  console.log(
    `\n  W sensitivity: Δpearson=${dP.toFixed(3)} Δseparation=${dS.toFixed(2)} ` +
      `over ww∈[${W_SWEEP[0]}, ${W_SWEEP[W_SWEEP.length - 1]}]`
  );
  let verdict: string;
  if (inert) {
    verdict =
      "W INERT - uniform metric is justified for this corpus (W carries no recoverable structure).";
  } else if (pProd > pDrop + 1e-6) {
    verdict =
      "W HELPS - mixing the number line in raises fidelity; it deserves a (positive) weight.";
  } else {
    verdict =
      `W HURTS - dropping W beats production (pearson ${pDrop.toFixed(3)} vs ` +
      `${pProd.toFixed(3)}); the number line is an incommensurable axis that ` +
      "degrades the structural map, and numberLineScale=0.1 only limits the damage.";
  }
  console.log(`  Verdict: ${verdict}`);

  // -- Minkowski signature (W timelike) ---------------------------------------
  // Self-check: the spacelike (all-+) branch must reproduce the production
  // pearson, or the indefinite scorer is measuring something else.
  const selfSpacelike = minkowskiScore(g, p, 1, 1).pearson;
  const prodPearson = mapFidelity(g, p, { seed: 1 }).pearson;
  const ok = Math.abs(selfSpacelike - prodPearson) < 1e-9;
  console.log(
    "\n  Minkowski signature (W timelike: s² = dx²+dy²+dz² − λ·dw²):"
  );
  console.log(
    `    [self-check] spacelike pearson@λ=1 ${selfSpacelike.toFixed(6)} vs ` +
      `production ${prodPearson.toFixed(6)} ${ok ? "✓" : "✗ MISMATCH"}`
  );
  console.log("    λ       pearson  spacelike  timelike%adj  timelike%non");
  // The honest test: a Minkowski sign is worth pursuing only if some λ makes the
  // timelike pearson BEAT the pure-spatial baseline (W dropped). Adjacency going
  // timelike at large λ is not enough on its own - graph-adjacent pairs are
  // spatially close, so they cross s²<0 first regardless of whether the number
  // line carries structure; that happens in a regime where pearson is collapsing.
  const baseline = pear[iDrop]; // spacelike pearson with W dropped (ww=0)
  let bestTimelike = Number.NEGATIVE_INFINITY;
  for (const lam of W_SWEEP) {
    if (lam === 0) continue; // λ=0 is pure-spatial, identical to spacelike
    const t = minkowskiScore(g, p, lam, -1);
    const s = minkowskiScore(g, p, lam, 1);
    bestTimelike = Math.max(bestTimelike, t.pearson);
    console.log(
      `   ${lam.toFixed(2).padStart(5)}   ${fmt(t.pearson)}   ${fmt(
        s.pearson
      )}     ${fmt(t.timelikeAdj, 2)}        ${fmt(t.timelikeNon, 2)}`
    );
  }
  console.log(
    `  Verdict: ${
      wPopulated === 0
        ? "signature irrelevant - W is empty, timelike and spacelike coincide."
        : bestTimelike > baseline + 0.01
          ? `TIMELIKE HELPS - best timelike pearson ${bestTimelike.toFixed(3)} ` +
            `beats the pure-spatial baseline ${baseline.toFixed(3)}; a Minkowski ` +
            "sign on W recovers structure the positive metric cannot."
          : `timelike signature does NOT help - best timelike pearson ` +
            `${bestTimelike.toFixed(3)} never beats the pure-spatial baseline ` +
            `${baseline.toFixed(3)}. Adjacent pairs only go timelike at large λ ` +
            "where the correlation is already collapsing - spatial proximity " +
            "flipping sign, not a recovered causal axis."
    }`
  );
}

function main(): void {
  console.log(
    "\nAnisotropic-metric sweep - testing dimensions_theory.md §2 against ModPAT's\n" +
      "uniform Euclidean metric. Only relative axis weights matter (pearson and\n" +
      "separation are scale-invariant), so X=Y=Z=1 throughout and W is swept.\n" +
      "Implicit production weight on W is numberLineScale=0.1 (see placeGraph)."
  );
  for (const c of CORPORA) runCorpus(c);
  console.log(
    "\nTakeaway: an axis is only worth a metric weight where the sweep moves a\n" +
      "fidelity number. Flat ⇒ keep the uniform metric, now with evidence. Moving\n" +
      "⇒ the 'coherent axis scales' assumption is false and W wants a principled\n" +
      "weight. The Minkowski block tests whether a timelike SIGN on W (not just a\n" +
      "weight) recovers causal structure the positive-definite metric cannot.\n"
  );
}

main();
