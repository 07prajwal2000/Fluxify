import type { ArtifactEntry } from "./compiledRuntime";
import type { AsyncExecutorLimits } from "./asyncExecutor";
import type { JobEnvelope } from "../jobs/types";
import type { TraceRunPayload } from "@fluxify/common/otlp";

/** handed to the isolated execution process over Bun IPC at spawn */
export type ExecutionBootstrap = {
	projectId: string;
	port: number;
	/** idle database integration timeout, supplied by the supervisor in milliseconds */
	databaseIdleTimeoutMs: number;
	/** bounded process-local runner for optional async trigger replies */
	asyncExecutor: AsyncExecutorLimits;
	/** the full artifact set as of spawn, already unsealed */
	artifacts: ArtifactEntry[];
	/** hot-reloadable supervisor policy; false means no heartbeat or tracking */
	workerTimeoutsEnabled: boolean;
	/** hard request body ceiling in bytes; the child cannot read the env itself */
	maxRequestBodyBytes: number;
	/** the execution process clears its env, so logging config travels with it */
	logging: {
		level: any;
		otlpEndpoint: string;
		otlpHeaders: Record<string, string>;
		useOtlp: boolean;
	};
};

/** supervisor -> isolated execution process */
export type ExecutionMessage =
	| { type: "bootstrap"; bootstrap: ExecutionBootstrap }
	| { type: "artifact"; entry: ArtifactEntry }
	| { type: "monitoring"; enabled: boolean }
	// the supervisor owns NATS, the child owns user code: jobs cross here
	| { type: "job"; job: JobEnvelope };

/** isolated execution process -> supervisor */
export type ExecutionEvent =
	| { type: "ready" }
	| { type: "heartbeat" }
	| { type: "job-finished"; id: string; error?: string }
	/** user code asked to queue work; only the supervisor can publish it */
	| { type: "enqueue-job"; job: JobEnvelope }
	/** completed in untrusted execution; supervisor owns the NATS hand-off */
	| { type: "trace-finished"; run: TraceRunPayload }
	| {
			type: "execution-started";
			requestId: string;
			routeId: string;
			timeoutMs: number;
		}
	| { type: "execution-finished"; requestId: string };
