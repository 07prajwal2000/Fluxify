import type { ArtifactEntry } from "./compiledRuntime";

/** handed to an execution thread in workerData at spawn */
export type ThreadBootstrap = {
	threadId: number;
	projectId: string;
	port: number;
	/** the full artifact set as of spawn, already unsealed */
	artifacts: ArtifactEntry[];
	/** the thread clears its env, so logging config has to travel with it */
	logging: {
		level: any;
		otlpEndpoint: string;
		otlpHeaders: Record<string, string>;
		useOtlp: boolean;
	};
};

/** supervisor -> thread, after spawn */
export type ThreadMessage = { type: "artifact"; entry: ArtifactEntry };

/** thread -> supervisor */
export type ThreadEvent = { type: "ready"; threadId: number };
