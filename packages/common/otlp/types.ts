/**
 * Wire contract for one recorded route execution.
 *
 * The execution process records it and hands it to `exportRun` in the same
 * process, and, with recording on (#254), to the recordings stream, whose
 * consumer stores it as is. It is defined here, next to the exporter, so
 * producer and consumers cannot drift.
 */

/** One completed block execution. `seq` is assigned in record order. */
export type TraceSpanRecord = {
	seq: number;
	/** the span this one nests under; absent means it hangs off the run */
	parentSeq?: number;
	blockId: string;
	blockType: string;
	/** the name the user gave the block; absent when it has none */
	blockName?: string;
	/** set on a middleware's own span (#579) */
	middleware?: {
		id: string;
		name: string;
		phase: "before" | "after";
		position: number;
		blocks: string[];
	};
	/**
	 * The id of the custom block whose graph this span ran in, the innermost one
	 * when custom blocks nest. Absent on the route's own spans. Those `blockId`s belong
	 * to the nested graph's canvas, not the route's — overlaid on the route canvas
	 * they would highlight nothing.
	 */
	customBlockId?: string;
	/** `performance.now()` readings; converted against the run's `perfOrigin` */
	startedAt: number;
	endedAt: number;
	outcome: "success" | "failure";
	/** selected branch for condition blocks */
	branch?: "success" | "failure";
	input?: unknown;
	output?: unknown;
	/** already stringified — an `Error` does not survive the wire */
	error?: string;
	/** payload was cut to fit the per-span cap */
	truncated?: boolean;
	/** non-standard span info; absent on normal runs */
	metadata?: TraceSpanMetadata;
};

/** Only test runs (#627) fill it: what a suite's hook mocked; the span holds the mocked values. */
export type TraceSpanMetadata = {
	mocked: { input?: true; output?: true };
};

export type TraceRunPayload = {
	runId: string;
	projectId: string;
	/** Route fields; present on runs originating from an HTTP route. */
	routeId?: string;
	/** identifies the graph this run belongs to; resolved by the portal viewer */
	routeVersion?: string;
	method?: string;
	path?: string;
	/** Workflow fields; present on runs originating from a background workflow. */
	workflowId?: string;
	workflowVersion?: string;
	workflowName?: string;
	/**
	 * `Date.now()` and `performance.now()` sampled at the same instant.
	 *
	 * Span times are monotonic readings and mean nothing off-box. Wall clock is
	 * `startedAtWallMs + (spanTime - perfOrigin)`. Both are required — with only
	 * one, every exported span is timestamped wrong.
	 */
	startedAtWallMs: number;
	perfOrigin: number;
	/** `performance.now()` at run end */
	endedAt: number;
	outcome: "success" | "failure";
	statusCode?: number;
	/** the run hit the per-run byte cap */
	truncated?: boolean;
	/** spans the buffer refused; a non-zero value means this trace is incomplete */
	droppedSpans?: number;
	/**
	 * Set on a run forked by an async custom block. It outlives the request, so it
	 * cannot nest — it is its own root, linked back to the invoking span.
	 */
	parentRunId?: string;
	parentSeq?: number;
	/** set on a test run's trace (#627); the worker supervisor fills it, never the child */
	metadata?: TraceRunMetadata;
	spans: TraceSpanRecord[];
};

/** What a trace knows beyond its run. Only test runs (#627) fill it for now. */
export type TraceRunMetadata = {
	source: "test";
	/** e.g. `Test: <suite> · <case>` */
	label: string;
	testRunId: string;
	suiteId: string;
	suiteName: string;
	caseIndex: number;
	caseName: string;
};
