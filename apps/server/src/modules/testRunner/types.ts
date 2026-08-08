import type { ProjectConfigPayload } from "../compiler/artifacts";

/**
 * Everything the ephemeral suite process is given, in one message.
 *
 * The child starts cold: no database, no NATS, no artifact store, no
 * credentials. Anything missing here is not reachable from inside it — which is
 * the point. `config` is the payload `resolveSuiteConfig` produced, so the
 * suite's overrides are already applied and no override travels separately.
 */
export type TestBootstrap = {
	suiteRunId: string;
	projectId: string;
	route: {
		id: string;
		projectName: string;
		bodySchema?: unknown;
		querySchema?: unknown;
		paramsSchema?: unknown;
	};
	/** compiled graph source — the child never sees blocks or edges */
	source: string;
	customBlocks: Array<{ name: string; source: string }>;
	config: ProjectConfigPayload;
	request: {
		method: string;
		path: string;
		headers: Record<string, string>;
		query: Record<string, string | string[]>;
		params: Record<string, string>;
		body: unknown;
	};
	/** route.timeoutSeconds * 1000 — drives both the in-band stopper and the watchdog */
	timeoutMs: number;
};

/**
 * The raw response, never a verdict. Assertions are evaluated in the parent so
 * there is one implementation of them, not two.
 */
export type TestResult =
	| {
			ok: true;
			status: number;
			data: unknown;
			headers: Record<string, string>;
			durationMs: number;
	  }
	| { ok: false; error: string; timedOut?: boolean; durationMs: number };

export type TestBootstrapMessage = { type: "bootstrap"; bootstrap: TestBootstrap };
export type TestChildMessage =
	| { type: "ready" }
	| { type: "result"; result: TestResult };
