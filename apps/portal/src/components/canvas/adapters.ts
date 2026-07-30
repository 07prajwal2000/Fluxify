import { BLOCK_TYPES } from "./blocks/blockTypes";
import { stickyNoteData, type StickyNoteData } from "./blocks/stickyNoteData";
import { FLOW_EDGE_TYPE } from "./edges";
import type {
	BlockEdge,
	BlockNode,
	CanvasBlock,
	CanvasEdge,
	CanvasGraph,
} from "./types";

/**
 * Notes carry their own box and a strict data shape, so they are normalised on
 * the way in: the size becomes the node's width/height (React Flow owns it while
 * resizing) and missing fields are filled so the block stays savable.
 */
function noteNodeFields(
	block: CanvasBlock,
): Partial<Pick<BlockNode, "data" | "width" | "height">> {
	if (block.type !== BLOCK_TYPES.stickynote) return {};
	const data = stickyNoteData(block.data);
	return { data, width: data.size.width, height: data.size.height };
}

export function blockToNode(block: CanvasBlock): BlockNode {
	return {
		id: block.id,
		type: block.type,
		position: block.position,
		data: block.data ?? {},
		...noteNodeFields(block),
	};
}

export function nodeToBlock(node: BlockNode): CanvasBlock {
	return {
		id: node.id,
		type: node.type ?? "default",
		position: node.position,
		data: node.type === BLOCK_TYPES.stickynote ? noteDataOf(node) : (node.data ?? {}),
	};
}

/** Copies the node's live box back into a note's `data.size`. */
function noteDataOf(node: BlockNode): StickyNoteData {
	const data = stickyNoteData(node.data);
	return {
		...data,
		size: stickyNoteData({
			size: {
				width: node.width ?? node.measured?.width ?? data.size.width,
				height: node.height ?? node.measured?.height ?? data.size.height,
			},
		}).size,
	};
}

export function canvasEdgeToFlowEdge(edge: CanvasEdge): BlockEdge {
	return {
		id: edge.id,
		type: FLOW_EDGE_TYPE,
		source: edge.from,
		target: edge.to,
		sourceHandle: edge.fromHandle || null,
		targetHandle: edge.toHandle || null,
	};
}

export function flowEdgeToCanvasEdge(edge: BlockEdge): CanvasEdge {
	return {
		id: edge.id,
		from: edge.source,
		to: edge.target,
		fromHandle: edge.sourceHandle ?? "",
		toHandle: edge.targetHandle ?? "",
	};
}

export function graphToFlow(graph: CanvasGraph): {
	nodes: BlockNode[];
	edges: BlockEdge[];
} {
	return {
		nodes: graph.blocks.map(blockToNode),
		edges: graph.edges.map(canvasEdgeToFlowEdge),
	};
}

export function flowToGraph(
	nodes: BlockNode[],
	edges: BlockEdge[],
): CanvasGraph {
	return {
		blocks: nodes.map(nodeToBlock),
		edges: edges.map(flowEdgeToCanvasEdge),
	};
}

export const emptyGraph: CanvasGraph = { blocks: [], edges: [] };
