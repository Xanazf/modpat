/**
 * topology_summary - print the TDA Mapper nerve graph and H₁ persistence bars.
 *
 * Usage:
 *   tsx scripts/dev/topology_summary.ts [--lens posX|mass|density] [--intervals N]
 */

import { program } from "commander";
import Runtime from "@core_i/Runtime";
import { buildNerveGraph } from "@core_s/TopologyMapper";
import { buildFrameworkIndex } from "@core_s/FrameworkIndex";

program
  .option("--lens <type>", "lens function: posX | mass | density", "posX")
  .option("--intervals <n>", "number of cover intervals", "10")
  .option("--overlap <f>", "fractional interval overlap [0,1)", "0.5")
  .option("--top-k <n>", "atoms to include in persistence homology", "500")
  .parse();

const opts = program.opts<{
  lens: "posX" | "mass" | "density";
  intervals: string;
  overlap: string;
  topK: string;
}>();

async function main() {
  const rt = await Runtime.boot({
    db: ":memory:",
    noWorkers: true,
    skipIdentity: true,
  });
  await rt.ready;

  const system = rt.lifecycle!.getActiveSystem();

  const graph = buildNerveGraph(system, {
    lens: opts.lens,
    numIntervals: parseInt(opts.intervals, 10),
    overlap: parseFloat(opts.overlap),
    topK: parseInt(opts.topK, 10),
  });

  console.log("\n=== TDA Mapper Nerve Graph ===\n");
  console.log(
    `Lens: ${opts.lens}  Nodes: ${graph.nodes.length}  Edges: ${graph.edges.length}\n`
  );

  console.log("Nodes:");
  for (const node of graph.nodes) {
    console.log(
      `  [${node.id}] ${node.label}  atoms=${node.atoms.length}` +
        `  center=(${node.clusterCenter.map(v => v.toFixed(2)).join(", ")})`
    );
  }

  console.log("\nEdges:");
  for (const edge of graph.edges) {
    const flag = edge.topoInterest ? " *** high topo interest ***" : "";
    console.log(
      `  ${edge.nodeA} -- ${edge.nodeB}  shared=${edge.commonAtoms.length}${flag}`
    );
  }

  console.log("\n=== Persistent Homology ===\n");

  const fmt = (b: number, d: number) =>
    `[${b.toFixed(3)}, ${d === Infinity ? "∞" : d.toFixed(3)}]`;

  console.log("H₀ (connected components):");
  for (const bar of graph.diagram.h0) {
    if (bar.death < Infinity) {
      console.log(
        `  atom ${bar.generatorAtomId}  ${fmt(bar.birth, bar.death)}`
      );
    }
  }
  const essH0 = graph.diagram.h0.filter(b => b.death === Infinity);
  console.log(`  ${essH0.length} essential component(s) (infinite bars)`);

  console.log("\nH₁ (loops):");
  if (graph.diagram.h1.length === 0) {
    console.log("  (none)");
  } else {
    for (const bar of graph.diagram.h1.slice(0, 20)) {
      console.log(
        `  atom ${bar.generatorAtomId}  ${fmt(bar.birth, bar.death)}` +
          `  persistence=${(bar.death - bar.birth).toFixed(3)}`
      );
    }
    if (graph.diagram.h1.length > 20) {
      console.log(`  ... (${graph.diagram.h1.length - 20} more bars)`);
    }
  }

  // -- E0: Three-tier framework index ----------------------------------------
  const fw = buildFrameworkIndex(system, graph);
  console.log("\n=== Framework Index (E0) ===\n");
  console.log(
    `Superclusters: ${fw.superclusters.length}  Clusters: ${fw.clusters.length}  Subclusters: ${fw.subclusters.length}  Interstitial: ${fw.interstitial.size}\n`
  );

  for (const sc of fw.superclusters) {
    console.log(
      `  Supercluster [${sc.id}]  atoms=${sc.memberAtomIds.size}  seeds=[${sc.seedAtomIds.join(",")}]`
    );
    for (const cid of sc.childClusterIds) {
      const cl = fw.clusters.find(c => c.id === cid)!;
      console.log(
        `    Cluster [${cl.id}]  atoms=${cl.memberAtomIds.size}  seeds=[${cl.seedAtomIds.join(",")}]`
      );
      for (const sid of cl.childSubclusterIds) {
        const sub = fw.subclusters.find(s => s.id === sid)!;
        console.log(
          `      Subcluster [${sub.id}]  atoms=${sub.memberAtomIds.size}`
        );
      }
    }
  }

  if (fw.crossFrameEdges.length > 0) {
    console.log(`\nCross-frame edges (topoInterest, cross-supercluster):`);
    for (const e of fw.crossFrameEdges) {
      console.log(
        `  atom ${e.from} -- atom ${e.to}  persistence=${e.persistence.toFixed(3)}`
      );
    }
  }

  await rt.dispose();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
