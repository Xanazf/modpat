import { buildGraphFromText } from "@core_s/grounding/TextGraph";
for (const s of ["zzz qqq vvv", "zzz", "zzz qqq"]) {
  const g = buildGraphFromText(s);
  console.log(JSON.stringify(s).padEnd(16),
    "nodes:", JSON.stringify(g.nodes.map(n => n.label)),
    "edges:", g.edges.map(e => `${g.nodes[e.from].label}->${g.nodes[e.to].label}`).join(","));
}
