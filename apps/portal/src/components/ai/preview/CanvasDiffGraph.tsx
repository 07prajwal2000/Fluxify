import { layoutGraph } from "@fluxify/blocks/layout";
import { Background, Controls, type Edge, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import "@xyflow/react/dist/style.css";
import type { CanvasDiff, DiffEdge } from "./canvasDiff";
import { type DiffFlowNode, DiffNode } from "./DiffNode";

const NODE_TYPES = { diff: DiffNode };

const STROKE: Record<DiffEdge["status"], string> = {
	same: "var(--muted)",
	added: "var(--success)",
	removed: "var(--danger)",
};

/** Positions from the canvas when every block has one, else laid out (a diff built from ops alone has none). */
function positions(diff: CanvasDiff) {
	if (diff.blocks.every((b) => b.position)) return undefined;
	const keys = new Map(diff.blocks.map((b) => [b.key, b.key]));
	return layoutGraph(
		diff.blocks.map((b) => ({ id: b.key, type: b.type })),
		diff.edges.filter((e) => keys.has(e.from) && keys.has(e.to)),
	);
}

/**
 * The diff as a small read-only canvas: green added, amber changed, red ghosts
 * removed. It does not take the scroll wheel (the chat scrolls past it); drag pans.
 */
export default function CanvasDiffGraph({
	diff,
	selected,
	onSelect,
}: {
	diff: CanvasDiff;
	selected?: string;
	onSelect: (key: string) => void;
}) {
	const { nodes, edges } = useMemo(() => {
		const laid = positions(diff);
		const nodes: DiffFlowNode[] = diff.blocks.map((block) => ({
			id: block.key,
			type: "diff",
			position: laid?.[block.key] ?? block.position ?? { x: 0, y: 0 },
			data: { block, selected: block.key === selected },
			draggable: false,
			connectable: false,
		}));
		const edges: Edge[] = diff.edges.map((e) => ({
			id: e.id,
			source: e.from,
			target: e.to,
			label: e.handle === "source" ? undefined : e.handle,
			style: {
				stroke: STROKE[e.status],
				strokeDasharray: e.status === "removed" ? "5 4" : undefined,
				opacity: e.status === "removed" ? 0.6 : 1,
			},
			labelStyle: { fontSize: 10, fill: "var(--muted)" },
		}));
		return { nodes, edges };
	}, [diff, selected]);

	return (
		<div className="h-64 overflow-hidden rounded-lg border border-border bg-background">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={NODE_TYPES}
				onNodeClick={(_, node) => onSelect(node.id)}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				zoomOnScroll={false}
				zoomOnDoubleClick={false}
				preventScrolling={false}
				fitView
				minZoom={0.2}
				proOptions={{ hideAttribution: true }}
			>
				<Background color="var(--border)" />
				<Controls showInteractive={false} />
			</ReactFlow>
		</div>
	);
}
