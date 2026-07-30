import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { HANDLE_CONFIG, type HandleKind, type HandleSide } from "../blocks/handles/handleConfig";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { BlockEdge, BlockNode } from "../types";

/** Where a handle sits on the block, in ELK's compass terms. */
const ELK_SIDE: Record<HandleSide, string> = {
	left: "WEST",
	right: "EAST",
	top: "NORTH",
	bottom: "SOUTH",
};

const HANDLE_KINDS = Object.keys(HANDLE_CONFIG) as HandleKind[];

/**
 * Handle ids are `<blockId>-<kind>`, so the socket geometry ELK needs comes
 * straight from HANDLE_CONFIG — the layout can't drift from what's rendered.
 */
export function portSide(handleId: string): string {
	const kind = HANDLE_KINDS.find((candidate) => handleId.endsWith(`-${candidate}`));
	return ELK_SIDE[kind ? HANDLE_CONFIG[kind].side : "right"];
}

/** Fallbacks for blocks React Flow hasn't measured yet. */
const FALLBACK_WIDTH = 168;
const FALLBACK_HEIGHT = 48;

export type LayoutOptions = {
	/** Gap between blocks in the same column. */
	nodeSpacing?: number;
	/** Gap between columns. */
	layerSpacing?: number;
};

export type LayoutPositions = Record<string, { x: number; y: number }>;

/**
 * Builds the ELK graph for a left-to-right layout: one column per step, each
 * block's ports pinned to the edge its handle is rendered on. Sticky notes are
 * excluded so they stay where the user put them.
 *
 * Pure, so the layout description can be verified without running ELK.
 */
export function buildElkGraph(
	nodes: BlockNode[],
	edges: BlockEdge[],
	{ nodeSpacing = 24, layerSpacing = 64 }: LayoutOptions = {},
): ElkNode {
	const laidOut = nodes.filter((node) => node.type !== BLOCK_TYPES.stickynote);
	const placed = new Set(laidOut.map((node) => node.id));
	const ports = new Map<string, Set<string>>();
	const addPort = (nodeId: string, handleId: string | null | undefined) => {
		if (!handleId || !placed.has(nodeId)) return;
		const existing = ports.get(nodeId) ?? new Set<string>();
		existing.add(handleId);
		ports.set(nodeId, existing);
	};

	const layoutEdges = edges.filter(
		(edge) => placed.has(edge.source) && placed.has(edge.target),
	);
	for (const edge of layoutEdges) {
		addPort(edge.source, edge.sourceHandle);
		addPort(edge.target, edge.targetHandle);
	}

	return {
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.spacing.nodeNode": String(nodeSpacing),
			"elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
			"elk.spacing.edgeNode": String(nodeSpacing),
			"elk.spacing.edgeEdge": String(nodeSpacing),
			"elk.edgeRouting": "POLYLINE",
		},
		children: laidOut.map((node) => ({
			id: node.id,
			width: node.measured?.width ?? node.width ?? FALLBACK_WIDTH,
			height: node.measured?.height ?? node.height ?? FALLBACK_HEIGHT,
			layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
			ports: [...(ports.get(node.id) ?? [])].map((portId) => ({
				id: portId,
				layoutOptions: { "elk.port.side": portSide(portId) },
			})),
		})),
		edges: layoutEdges.map((edge) => ({
			id: edge.id,
			sources: [edge.sourceHandle || edge.source],
			targets: [edge.targetHandle || edge.target],
		})),
	};
}

/**
 * Runs the horizontal layout and returns the new position per block id. Blocks
 * ELK didn't place (sticky notes) are omitted, so callers keep their positions.
 */
export async function layoutBlocks(
	nodes: BlockNode[],
	edges: BlockEdge[],
	options: LayoutOptions = {},
): Promise<LayoutPositions> {
	const graph = buildElkGraph(nodes, edges, options);
	if (!graph.children?.length) return {};

	const result = await new ELK().layout(graph);
	const positions: LayoutPositions = {};
	for (const child of result.children ?? []) {
		if (child.x === undefined || child.y === undefined) continue;
		positions[child.id] = { x: child.x, y: child.y };
	}
	return positions;
}
