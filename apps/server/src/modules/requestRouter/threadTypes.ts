import type { ArtifactEntry } from "./compiledRuntime";
import type { AsyncExecutorLimits } from "./asyncExecutor";
import type { JobEnvelope } from "../jobs/types";

/** handed to the isolated execution process over Bun IPC at spawn */
export type ExecutionBootstrap = {
	projectId: string;
	port: number;
	/** idle database integration timeout, supplied by the supervisor in milliseconds */
	databaseIdleTimeoutMs: number;
	/** bounded process-local runner for optional async trigger replies */
	asyncExecutor: AsyncExecutorLimits;
	/** the base domain as configured, empty when unset — the child applies the default (#340) */
	baseDomain: string;
	/** `TRUSTED_ORIGINS`, parsed; the child clears its env so it cannot read it */
	trustedOrigins: string[];
	/** the full artifact set as of spawn, already unsealed */
	artifacts: ArtifactEntry[];
	/** hot-reloadable supervisor policy; false means no heartbeat or tracking */
	workerTimeoutsEnabled: boolean;
	/** hard request body ceiling in bytes; the child cannot read the env itself */
	maxRequestBodyBytes: number;
	/** furthest ahead a Trigger Workflow block may schedule a run, in milliseconds */
	scheduleHorizonMs: number;
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
	| { type: "base-domain"; baseDomain: string }
	// the supervisor owns NATS, the child owns user code: jobs cross here
	| { type: "job"; job: JobEnvelope };

/** isolated execution process -> supervisor */
export type ExecutionEvent =
	| { type: "ready" }
	| { type: "heartbeat" }
	| { type: "job-finished"; id: string; error?: string }
	/** user code asked to queue work; only the supervisor can publish it */
	| { type: "enqueue-job"; job: JobEnvelope }
	/** a queue trigger's source is gone; only the admin can disable it */
	| { type: "trigger-fault"; triggerId: string; projectId: string; reason: string }
	| {
			type: "execution-started";
			requestId: string;
			routeId: string;
			timeoutMs: number;
		}
	| { type: "execution-finished"; requestId: string };
