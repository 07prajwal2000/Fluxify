import { logger } from "@fluxify/common";
import {
	ensureStream,
	ensureStreamConsumer,
	natsConnection,
	publishToStream,
	purgeSchedule,
	readSubject,
	type StreamSpec,
} from "@fluxify/common/nats";
import { generateID } from "@fluxify/lib";
import { publishMessage, subscribeToChannel } from "@fluxify/server";
import type { Mode } from "../tools";
import type { AgentEvent } from "./events";

/**
 * The new agent (#646) on NATS, apart from the old harness:
 * - jobs: a work queue (`fluxify.agent.start|continue.<conversationId>`), one
 *   durable consumer shared by every gateway replica;
 * - live events: `agent.run.<runId>` on a limits stream kept an hour, which a
 *   client replays from the start and then follows;
 * - stop: a core NATS signal to whichever worker holds the run.
 */
export const AGENT_STREAM = "FLUXIFY_AGENT";
export const AGENT_CONSUMER = "fluxify_agent";
export const RUN_EVENTS_STREAM = "FLUXIFY_AGENT_RUNS";

export const agentJobSubject = (type: AgentJob["type"], conversationId: string) =>
	`fluxify.agent.${type}.${conversationId}`;
export const runEventsSubject = (runId: string) => `agent.run.${runId}`;
const stopSubject = (conversationId: string) => `agent.stop.${conversationId}`;

const JOBS: StreamSpec = {
	name: AGENT_STREAM,
	subjects: ["fluxify.agent.>"],
	retention: "workqueue",
	maxAgeMs: 60 * 60_000,
	duplicateWindowMs: 2 * 60_000,
};
const EVENTS: StreamSpec = {
	name: RUN_EVENTS_STREAM,
	subjects: ["agent.run.>"],
	retention: "limits",
	maxAgeMs: 60 * 60_000,
};

export type AgentJob = {
	type: "start" | "continue";
	conversationId: string;
	runId: string;
	userId: string;
	projectId: string;
	mode: Mode;
	/** start: the user's message. */
	message?: string;
	/** continue: the answer to the first waiting call. */
	approval?: { ok: boolean; reason?: string };
};

/** Declares both streams and the job consumer. Throws when NATS is down: it is a hard dependency. */
export async function initializeAgentQueue() {
	const nc = natsConnection();
	// A run is not idempotent: a dead worker's run is not replayed (see the harness queue).
	await ensureStreamConsumer(nc, JOBS, {
		durable: AGENT_CONSUMER,
		maxDeliver: 1,
		ackWaitMs: 30_000,
	});
	await ensureStream(nc, EVENTS);
	logger.info("Initialized", "AgentQueue");
}

export async function publishAgentJob(job: AgentJob) {
	const msgId = `${job.type}:${job.runId}:${generateID()}`;
	await publishToStream(natsConnection(), agentJobSubject(job.type, job.conversationId), job, {
		msgId,
	});
}

/** One batch of a run's events. */
export const publishRunEvents = (runId: string, events: AgentEvent[]) =>
	publishToStream(natsConnection(), runEventsSubject(runId), events).then(() => {});

/** Every batch so far, then live ones. */
export const readRunEvents = (runId: string) =>
	readSubject<AgentEvent[]>(natsConnection(), RUN_EVENTS_STREAM, runEventsSubject(runId));

/** Drops a run's events; before the run goes on after an approval, so the old `done` does not end the new stream. */
export const purgeRunEvents = (runId: string) =>
	purgeSchedule(natsConnection(), RUN_EVENTS_STREAM, runEventsSubject(runId));

export const requestStop = (conversationId: string) =>
	publishMessage(stopSubject(conversationId), conversationId);

/** Worker side: `onStop(conversationId)` for every stop request. */
export const subscribeStops = (onStop: (conversationId: string) => void) =>
	subscribeToChannel(stopSubject("*"), onStop);
