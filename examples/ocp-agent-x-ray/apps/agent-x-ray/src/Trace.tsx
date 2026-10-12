import { ReactFlow, Background, type Node, type Edge } from "@xyflow/react";
import { Check, X, Circle, LoaderCircle, ArrowUpRight } from "lucide-react";
import type { Step } from "./types";
const stages = ["discovery", "manifest", "query", "resolve"];
export function Trace({
  steps,
  selected,
  onSelect,
}: {
  steps: Step[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const nodes: Node[] = stages.map((id, i) => {
    const step = steps.find((s) => s.id === id);
    return {
      id,
      position: { x: i * 205, y: 55 },
      selectable: true,
      draggable: false,
      className: `trace-node ${step?.status ?? "idle"} ${selected === id ? "selected" : ""}`,
      data: {
        label: (
          <div>
            <div className="node-meta">
              <span>0{i + 1} / OCP</span>
              {step?.status === "passed" ? (
                <Check size={15} />
              ) : step?.status === "failed" ? (
                <X size={15} />
              ) : step?.status === "running" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Circle size={12} />
              )}
            </div>
            <strong>{id[0].toUpperCase() + id.slice(1)}</strong>
            <div className="node-time">
              {step?.durationMs !== undefined
                ? `${step.durationMs.toFixed(2)} ms`
                : step?.status === "skipped"
                  ? "Skipped"
                  : step?.status === "running"
                    ? "Executing…"
                    : "Awaiting run"}
              <ArrowUpRight size={13} />
            </div>
          </div>
        ),
      },
    };
  });
  const edges: Edge[] = stages
    .slice(1)
    .map((id, i) => ({
      id: `e${i}`,
      source: stages[i],
      target: id,
      animated: steps.find((s) => s.id === id)?.status === "running",
      style: {
        stroke:
          steps.find((s) => s.id === id)?.status === "failed"
            ? "#fb7775"
            : "#b3ec77",
        strokeWidth: 1.5,
      },
      type: "straight",
    }));
  return (
    <div className="trace-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onSelect(node.id)}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={1}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={18} size={1} color="#38453e" />
      </ReactFlow>
      <div className="trace-caption">
        点击节点查看调用证据 · Discovery 为直接 Catalog 定位
      </div>
    </div>
  );
}
