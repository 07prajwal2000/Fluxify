import { Position } from "@xyflow/react";
import {
	HANDLE_SIDE,
	type HandleKind,
	type HandleSide,
} from "@fluxify/blocks/layout";

/**
 * Socket kinds. Geometry, colour and connection limits are all derived from the
 * kind, so a block only declares which sockets it has.
 *
 * `target` is the single inbound socket: the graph is a DAG that may merge but
 * never diverges, so it is the only kind that accepts more than one connection.
 * Everything else is outbound and capped at one edge. Names match the handle
 * ids already persisted on edges (`<blockId>-<kind>`).
 */
// The kinds and the side each one sits on are shared with the layout in
// @fluxify/blocks, so a socket cannot be drawn on one side and routed to
// another. Everything below is rendering-only.
export type { HandleKind, HandleSide };

export type HandleConfig = {
	/** React Flow direction: `target` = inbound, `source` = outbound. */
	flow: "source" | "target";
	side: HandleSide;
	position: Position;
	shape: "rect" | "circle";
	/** Themed colour (design-system token with a standalone fallback). */
	color: string;
	/** `null` = unlimited. */
	maxConnections: number | null;
	label: string;
};

export const HANDLE_CONFIG: Record<HandleKind, HandleConfig> = {
	target: {
		flow: "target",
		side: HANDLE_SIDE.target,
		position: Position.Left,
		shape: "rect",
		color: "var(--fx-block-fg, #18181b)",
		maxConnections: null,
		label: "Input",
	},
	source: {
		flow: "source",
		side: HANDLE_SIDE.source,
		position: Position.Right,
		shape: "circle",
		color: "var(--violet, #7c5cff)",
		maxConnections: 1,
		label: "Next",
	},
	success: {
		flow: "source",
		side: HANDLE_SIDE.success,
		position: Position.Right,
		shape: "circle",
		color: "var(--success, #40c057)",
		maxConnections: 1,
		label: "Success",
	},
	failure: {
		flow: "source",
		side: HANDLE_SIDE.failure,
		position: Position.Right,
		shape: "circle",
		color: "var(--danger, #e5484d)",
		maxConnections: 1,
		label: "Failure",
	},
	executor: {
		flow: "source",
		side: HANDLE_SIDE.executor,
		position: Position.Top,
		shape: "circle",
		color: "var(--violet, #7c5cff)",
		maxConnections: 1,
		label: "Body",
	},
};

/** Handle id as persisted on edges: `<blockId>-<kind>`. */
export function handleId(blockId: string, kind: HandleKind) {
	return `${blockId}-${kind}`;
}
