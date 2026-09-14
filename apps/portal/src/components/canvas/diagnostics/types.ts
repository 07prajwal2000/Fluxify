export type DiagnosticSeverity = "error" | "warning" | "info";

export type BlockDiagnostic = {
	blockId: string;
	severity: DiagnosticSeverity;
	message: string;
	source: string;
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
