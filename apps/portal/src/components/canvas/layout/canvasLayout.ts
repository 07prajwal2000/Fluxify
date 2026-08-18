import {
	handleSide,
	layoutGraph,
	type LayoutOptions,
	type LayoutPositions,
} from "@fluxify/blocks/layout";
import type { BlockEdge, BlockNode } from "../types";

// The layout itself lives in @fluxify/blocks so the AI harness formats a canvas
// exactly the way the Format button does. This file is only the React Flow
// adapter: measured sizes and `source`/`target` naming are editor-side details.
export { handleSide, type LayoutOptions, type LayoutPositions };

const toNodes = (nodes: BlockNode[]) =>
	nodes.map((node) => ({
		id: node.id,
		type: node.type,
		position: node.position,
		width: node.measured?.width ?? node.width,
		height: node.measured?.height ?? node.height,
	}));

const toEdges = (edges: BlockEdge[]) =>
	edges.map((edge) => ({
		id: edge.id,
		from: edge.source,
		to: edge.target,
		fromHandle: edge.sourceHandle,
		toHandle: edge.targetHandle,
	}));

/** Runs the horizontal layout and returns the new position per block id. */
export async function layoutBlocks(
	nodes: BlockNode[],
	edges: BlockEdge[],
	options: LayoutOptions = {},
): Promise<LayoutPositions> {
	return layoutGraph(toNodes(nodes), toEdges(edges), options);
}
