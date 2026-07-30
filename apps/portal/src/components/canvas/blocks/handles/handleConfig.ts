import { Position } from "@xyflow/react";

/**
 * Socket kinds. Geometry, colour and connection limits are all derived from the
 * kind, so a block only declares which sockets it has.
 *
 * `target` is the single inbound socket: the graph is a DAG that may merge but
 * never diverges, so it is the only kind that accepts more than one connection.
 * Everything else is outbound and capped at one edge. Names match the handle
 * ids already persisted on edges (`<blockId>-<kind>`).
 */
export type HandleKind =
	| "source"
	| "target"
	| "executor"
	| "success"
	| "failure";

/** Which edge of the block the socket rail sits on. */
export type HandleSide = "left" | "right" | "top" | "bottom";

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
		side: "left",
		position: Position.Left,
		shape: "rect",
		color: "var(--fx-block-fg, #18181b)",
		maxConnections: null,
		label: "Input",
	},
	source: {
		flow: "source",
		side: "right",
		position: Position.Right,
		shape: "circle",
		color: "var(--violet, #7c5cff)",
		maxConnections: 1,
		label: "Next",
	},
	success: {
		flow: "source",
		side: "right",
		position: Position.Right,
		shape: "circle",
		color: "var(--success, #40c057)",
		maxConnections: 1,
		label: "Success",
	},
	failure: {
		flow: "source",
		side: "right",
		position: Position.Right,
		shape: "circle",
		color: "var(--danger, #e5484d)",
		maxConnections: 1,
		label: "Failure",
	},
	executor: {
		flow: "source",
		side: "top",
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
