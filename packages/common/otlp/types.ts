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
	/** the user's own frames, when the error came from the user's code (#731) */
	stack?: string;
	/** payload was cut to fit the per-span cap */
	truncated?: boolean;
	/** viewer-only span info; never exported over OTLP */
	metadata?: TraceSpanMetadata;
};

export type TraceSpanMetadata = {
	/** test runs only (#627): what a suite's hook mocked; the span holds the mocked values */
	mocked?: { input?: true; output?: true };
	/** the block's canvas position when it was compiled (#628): a deleted block can still be drawn */
	position?: { x: number; y: number };
	/** the block a Switch handed off to (#628): its case edges share one handle */
	next?: string;
	/** the programmable block whose `executeHandle` ran this span (R5): nest it under that block */
	owner?: string;
	/** a `ctx.span` child nested in another: that span's `blockId` (R5) */
	parent?: string;
	/** a route's own entrypoint span only: the headers the run answered with */
	response?: { status?: number; headers: Record<string, string> };
};

export type TraceRunPayload = {
	runId: string;
	projectId: string;
	/** Route fields; present on runs originating from an HTTP route. */
	routeId?: string;
	/**
	 * The version of the graph this run served (#782): the id of a `canvas_versions`
	 * row, set by any worker that runs a versioned artifact — production traffic, a
	 * prod-env test run and the promote gate's candidate run. Absent on a run of the
	 * working copy, which has no version.
	 */
	versionId?: string;
	/** the artifact's own identity: the compile timestamp in development, the version id in production */
	routeVersion?: string;
	method?: string;
	path?: string;
	/** Workflow fields; present on runs originating from a background workflow. */
	workflowId?: string;
	workflowVersion?: string;
	workflowName?: string;
	/** A sandbox's run (#735), over HTTP or as a workflow: set instead of `routeId` / `workflowId`. */
	sandboxId?: string;
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
	/** `cancelled`: the user stopped a workflow run (#1035); its spans are kept */
	outcome: "success" | "failure" | "cancelled";
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
	/** the worker's environment (#732); the supervisor stamps it on publish, absent reads as production */
	env?: "production" | "development";
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
