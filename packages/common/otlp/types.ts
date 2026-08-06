/**
 * Wire contract for one recorded route execution.
 *
 * The execution process records it, the supervisor publishes it, and the
 * telemetry worker hands it to `exportRun`. It is defined here, next to the
 * exporter, so producer and consumer cannot drift.
 */

/** One completed block execution. `seq` is assigned in record order. */
export type TraceSpanRecord = {
	seq: number;
	/** the span this one nests under; absent means it hangs off the run */
	parentSeq?: number;
	blockId: string;
	blockType: string;
	/**
	 * Set when this span came from inside a custom block. Those `blockId`s belong
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
};

export type TraceRunPayload = {
	runId: string;
	projectId: string;
	routeId: string;
	/** identifies the graph this run belongs to; resolved by the portal viewer */
	routeVersion: string;
	method: string;
	path: string;
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
	spans: TraceSpanRecord[];
};
