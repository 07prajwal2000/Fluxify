export type DiagnosticSeverity = "error" | "warning" | "info";

const SOURCE_LABELS: Record<string, string> = {
	compile: "Canvas compilation",
	"cycle-detection": "Loop check: blocks must not connect back to themselves",
	"switch-cases": "Switch check: every case must be able to run",
};

/** what the panels show for a diagnostic's source; unknown sources show as-is */
export const diagnosticSourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

export type BlockDiagnostic = {
	/** omitted for a canvas-wide diagnostic (e.g. a compile error naming no block) */
	blockId?: string;
	severity: DiagnosticSeverity;
	message: string;
	source: string;
	/** still being worked out, e.g. a compile that has not reported yet */
	pending?: boolean;
};

export type BlockSeverities = {
	hasError: boolean;
	hasWarning: boolean;
	hasInfo: boolean;
};

export type CanvasDiagnosticsContextValue = {
	/** All active diagnostics across the canvas */
	all: BlockDiagnostic[];
	/** Diagnostics grouped by block id */
	byBlock: Map<string, BlockDiagnostic[]>;
	/** Get all diagnostics for a specific block */
	forBlock: (blockId: string) => BlockDiagnostic[];
	/** Highest severity present on a block, or null */
	highestSeverityForBlock: (blockId: string) => DiagnosticSeverity | null;
	/** Boolean flags for each severity type on a block */
	severitiesForBlock: (blockId: string) => BlockSeverities;
	/** Worst severity present on the canvas, or null if clean */
	worstSeverity: DiagnosticSeverity | null;
	/** Replace all diagnostics for a specific block */
	setForBlock: (blockId: string, diagnostics: BlockDiagnostic[]) => void;
	/** Clear diagnostics for a specific block, optionally filtered by source */
	clearForBlock: (blockId: string, source?: string) => void;
	/** Set all diagnostics from a given source (e.g. cycle-detection, validation) */
	setFromSource: (source: string, diagnostics: BlockDiagnostic[]) => void;
	/** Clear all diagnostics from a given source */
	clearSource: (source: string) => void;
	/** Clear all diagnostics across the entire canvas */
	clearAll: () => void;
	/** Re-run all registered validators and return updated diagnostics */
	revalidate: () => BlockDiagnostic[];
	/** Register a validator callback to run on revalidate / graph update */
	registerValidator: (id: string, validator: () => BlockDiagnostic[]) => () => void;
	/** Diagnostics side panel visibility state and controls */
	isPanelOpen: boolean;
	openPanel: () => void;
	closePanel: () => void;
	togglePanel: () => void;
};
