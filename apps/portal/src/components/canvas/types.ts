import type {
	Edge,
	EdgeTypes,
	Node,
	NodeTypes,
	Viewport,
} from "@xyflow/react";
import type { ChangeSet } from "./changes/changeTracker";

/** Arbitrary per-block configuration. Shape is owned by each block type. */
export type BlockData = Record<string, unknown>;

/** A block as it is stored/transported (server shape). */
export type CanvasBlock<TData extends BlockData = BlockData> = {
	id: string;
	type: string;
	data: TData;
	position: { x: number; y: number };
};

/** A connection as it is stored/transported (server shape). */
export type CanvasEdge = {
	id: string;
	from: string;
	to: string;
	fromHandle: string;
	toHandle: string;
};

/** Full graph payload handed to / returned from the canvas. */
export type CanvasGraph = {
	blocks: CanvasBlock[];
	edges: CanvasEdge[];
};

/** React Flow representations used inside the canvas. */
export type BlockNode = Node<BlockData>;
export type BlockEdge = Edge<{ cycle?: boolean; cycleFlash?: boolean }>;

export type CanvasMode = "edit" | "readonly";

export type BlockCanvasProps = {
	/** Initial graph. Re-applied whenever the object identity changes. */
	graph: CanvasGraph;
	/** `readonly` disables dragging, connecting, selecting and deleting. */
	mode?: CanvasMode;
	/** Fired on every structural change with the current graph and the tracked
	 *  delta since load (feed the delta to `buildSavePayload`). Empty in
	 *  `readonly` mode, where nothing is tracked. */
	onChange?: (graph: CanvasGraph, changes: ChangeSet) => void;
	/** Node renderers keyed by block type. Empty = React Flow default node. */
	nodeTypes?: NodeTypes;
	edgeTypes?: EdgeTypes;
	/** Undo/redo for positions and connections. Default `true`; always off in
	 *  `readonly` mode. Also hides the undo/redo buttons when `false`. */
	enableHistory?: boolean;
	/** Horizontal auto-layout button. Default `true`; always off in `readonly`. */
	enableFormat?: boolean;
	/** Block settings side panel, opened by double click or the block's open
	 *  action. Default `true`; available in `readonly` too (it only reads). */
	enablePanel?: boolean;
	/**
	 * Composable canvas features must default to disabled. Enable them explicitly
	 * from their owning route so embeds do not gain controls unintentionally.
	 * Core block picker and canvas quick actions. Default `false`; off in readonly.
	 */
	enableBlockPicker?: boolean;
	/** Canvas playground trigger. Default `false`; enable only from its owning route. */
	enablePlayground?: boolean;
	/** Playground content rendered in the canvas-owned modal, outside React Flow. */
	playgroundContent?: React.ReactNode;
	/** Copy/paste/duplicate of blocks and the edges between them. Default `true`;
	 *  always off in `readonly`. Also hides the copy/duplicate block actions. */
	enableClipboard?: boolean;
	/** Fit the graph into view on first render. Default `true`. */
	fitViewOnInit?: boolean;
	defaultViewport?: Viewport;
	/** Extra class on the canvas root. */
	className?: string;
	/** Increment to briefly flash every invalid cycle path. */
	cycleFeedbackToken?: number;
	/** Rendered inside React Flow — use for `<Panel>` based toolbars/overlays. */
	children?: React.ReactNode;
};
