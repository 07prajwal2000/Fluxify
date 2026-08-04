import type { ArtifactEntry } from "./compiledRuntime";

/** handed to the isolated execution process over Bun IPC at spawn */
export type ExecutionBootstrap = {
	projectId: string;
	port: number;
	/** idle database integration timeout, supplied by the supervisor in milliseconds */
	databaseIdleTimeoutMs: number;
	/** the full artifact set as of spawn, already unsealed */
	artifacts: ArtifactEntry[];
	/** hot-reloadable supervisor policy; false means no heartbeat or tracking */
	workerTimeoutsEnabled: boolean;
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
	| { type: "monitoring"; enabled: boolean };

/** isolated execution process -> supervisor */
export type ExecutionEvent =
	| { type: "ready" }
	| { type: "heartbeat" }
	| {
			type: "execution-started";
			requestId: string;
			routeId: string;
			timeoutMs: number;
		}
	| { type: "execution-finished"; requestId: string };
