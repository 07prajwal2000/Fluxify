import { type BrokerSource, type SseBroker, SseBrokerRegistry } from "@fluxify/adapters/sse";
import type { ContextVarsType } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { BAD_HANDLE, parseHandle, sseData } from "@fluxify/sdk/runtime";
import {
	kvIntegrationsCache,
	ownsIntegration,
	queueIntegrationsCache,
} from "../../loaders/integrationsLoader";
import { openStream, type SseStream } from "./sse";

/**
 * The `sse` global of JS blocks, workflows and custom blocks (#1023). A route
 * calls `connect(id)` and holds the socket; anything on any node reaches it
 * through the route's broker with the handle `<integrationId>:<id>`, so a
 * producer never loads the route.
 */

export type SseEnvelope =
	| { t: "data"; d: string; event?: string; eventId?: string }
	| { t: "close" }
	| { t: "closed" }
	/** `by` tells a connect its own takeover apart: NATS may deliver it to the new subscription */
	| { t: "takeover"; by?: string };

export type SseApi = NonNullable<ContextVarsType["sse"]>;

export const NO_BROKER = "SSE needs a broker integration in route settings";
export { BAD_HANDLE, parseHandle };

export const sseSubject = (projectId: string, id: string) => `fluxify.sse.${projectId}.${id}`;

/** a message is broker input from anyone: anything that is not an envelope is dropped */
export function parseEnvelope(message: string): SseEnvelope | undefined {
	try {
		const envelope = JSON.parse(message);
		if (["data", "close", "closed", "takeover"].includes(envelope?.t)) return envelope;
	} catch {}
	return undefined;
}

/** The route's NATS (queue) or Redis (kv) integration, only if `projectId` owns it. */
export function brokerSource(integrationId: string, projectId: string): BrokerSource | undefined {
	const queue = queueIntegrationsCache[integrationId];
	if (queue?.variant === "NATS" && ownsIntegration(queue, projectId))
		return { kind: "nats", config: queue };
	const kv = kvIntegrationsCache[integrationId];
	if (kv?.variant === "Redis" && ownsIntegration(kv, projectId))
		return { kind: "redis", config: kv };
	return undefined;
}

const registry = new SseBrokerRegistry(brokerSource);

/** `ready` settles once the subscription is held, so a `send` right after `connect` is not lost */
type Owner = { stream: SseStream; takenOver: boolean; ready: Promise<void> };
/** the streams this process holds, by subject */
const owners = new Map<string, Owner>();
/**
 * One signal per subject per process, so repeated `signal(handle)` calls share
 * one subscription.
 *
 * ponytail: a signal for a stream whose owner died without publishing `closed`
 * keeps its subscription until the process ends. Expire it if that ever shows.
 */
const signals = new Map<string, AbortController>();

/** what `send` returns: whether a client is on the stream, as far as this process has heard */
type Presence = {
	broker: SseBroker;
	connected: boolean;
	subscribed: Promise<() => Promise<void>>;
	idle?: ReturnType<typeof setTimeout>;
};
/**
 * ponytail: a sender only hears of a client leaving while it watches. Its first
 * send, or one after this long without any, assumes the client is there. A
 * presence query per send would cost a round trip per token.
 */
const PRESENCE_IDLE_MS = 10 * 60_000;
const presences = new Map<string, Presence>();

const publish = (broker: SseBroker, subject: string, envelope: SseEnvelope) =>
	broker.publish(subject, JSON.stringify(envelope));

/** Closes every broker connection. For shutdown and tests. */
export async function closeSseBrokers() {
	for (const owner of owners.values()) owner.stream.close();
	for (const presence of presences.values()) clearTimeout(presence.idle);
	presences.clear();
	await registry.closeAll();
}

export function createSseApi(options: {
	projectId: string;
	/** absent outside a route (a workflow, a job): `connect` is refused */
	request?: Request;
	/** the route's SSE broker setting */
	brokerId?: string;
}): SseApi {
	const { projectId } = options;
	let connectionId: string | undefined;
	const target = (handle: string) => {
		const { integrationId, id } = parseHandle(handle);
		return {
			broker: registry.brokerFor(projectId, integrationId),
			subject: sseSubject(projectId, id),
		};
	};
	return {
		get connectionId() {
			return connectionId;
		},
		connect(id) {
			if (!options.request) throw new Error("sse.connect can only be used in a route");
			if (!options.brokerId) throw new Error(NO_BROKER);
			if (typeof id !== "string" || !id) throw new Error("sse.connect needs an id");
			const handle = `${options.brokerId}:${id}`;
			const { broker, subject } = target(handle);
			hold(broker, subject, openOwnStream(subject, options.request));
			connectionId = handle;
			return handle;
		},
		async send(handle, data, options) {
			const { event, eventId } = options ?? {};
			const { broker, subject } = target(handle);
			const envelope: SseEnvelope = {
				t: "data",
				d: sseData(data),
				event: event === undefined ? undefined : String(event),
				eventId: eventId === undefined ? undefined : String(eventId),
			};
			await owners.get(subject)?.ready;
			try {
				const presence = await present(broker, subject);
				// published even when it reads false: a client may have just come back
				await publish(broker, subject, envelope);
				return presence.connected;
			} catch (error) {
				logger.warn(`[sse] send failed: ${(error as Error)?.message ?? error}`, "SSE.send");
				return false;
			}
		},
		async close(handle) {
			const { broker, subject } = target(handle);
			await publish(broker, subject, { t: "close" });
		},
		signal(handle) {
			const { broker, subject } = target(handle);
			// after this process's own connect has taken over, or that takeover aborts it
			return watch(broker, subject, owners.get(subject)?.ready).signal;
		},
	};
}

/** a stream already held here for the id is a takeover, not a client leaving */
function openOwnStream(subject: string, request: Request) {
	const previous = owners.get(subject);
	if (previous) previous.takenOver = true;
	try {
		return openStream(subject, request);
	} catch (error) {
		if (previous) previous.takenOver = false;
		throw error;
	}
}

/**
 * Takes the id over on every node, then subscribes and delivers until the
 * stream closes. Runs in the background: the reply is already streaming, and a
 * broker failure closes it with an error event.
 */
function hold(broker: SseBroker, subject: string, stream: SseStream) {
	const owner: Owner = { stream, takenOver: false, ready: Promise.resolve() };
	owners.set(subject, owner);
	const token = crypto.randomUUID();
	let unsubscribe: (() => Promise<void>) | undefined;
	stream.onClose(() => {
		if (owners.get(subject) === owner) owners.delete(subject);
		void unsubscribe?.();
		// a takeover already told every watcher; a late `closed` would abort the new holder's signals
		if (!owner.takenOver) void publish(broker, subject, { t: "closed" }).catch(() => undefined);
	});
	const onMessage = (message: string) => {
		const envelope = parseEnvelope(message);
		if (envelope?.t === "data")
			stream.write({ data: envelope.d, event: envelope.event, id: envelope.eventId });
		else if (envelope?.t === "close") stream.close();
		else if (envelope?.t === "takeover" && envelope.by !== token) {
			owner.takenOver = true;
			stream.close();
		}
	};
	owner.ready = (async () => {
		await publish(broker, subject, { t: "takeover", by: token });
		const undo = await broker.subscribe(subject, onMessage);
		if (stream.closed) await undo();
		else unsubscribe = undo;
	})().catch((error) => {
		stream.write({ event: "error", data: { message: String(error?.message ?? error) } });
		stream.close();
	});
}

/** Follows one stream for its senders: a client leaving reads false until a reconnect's takeover. */
async function present(broker: SseBroker, subject: string) {
	let presence = presences.get(subject);
	if (presence?.broker !== broker) {
		const fresh: Presence = {
			broker,
			connected: true,
			subscribed: broker.subscribe(subject, (message) => {
				const t = parseEnvelope(message)?.t;
				if (t === "closed" || t === "close") fresh.connected = false;
				else if (t === "takeover") fresh.connected = true;
			}),
		};
		presence = fresh;
		presences.set(subject, fresh);
		// a failed subscribe is retried by the next send, not cached
		fresh.subscribed.catch(() => {
			if (presences.get(subject) === fresh) presences.delete(subject);
		});
	}
	const current = presence;
	await current.subscribed;
	clearTimeout(current.idle);
	current.idle = setTimeout(() => {
		if (presences.get(subject) === current) presences.delete(subject);
		void current.subscribed.then((undo) => undo()).catch(() => undefined);
	}, PRESENCE_IDLE_MS);
	current.idle.unref?.();
	return current;
}

function watch(broker: SseBroker, subject: string, after?: Promise<void>) {
	const existing = signals.get(subject);
	if (existing) return existing;
	const controller = new AbortController();
	signals.set(subject, controller);
	let unsubscribe: (() => Promise<void>) | undefined;
	const abort = (reason: unknown) => {
		if (signals.get(subject) === controller) signals.delete(subject);
		controller.abort(reason);
		void unsubscribe?.();
	};
	Promise.resolve(after)
		.then(() =>
			broker.subscribe(subject, (message) => {
				const t = parseEnvelope(message)?.t;
				if (t === "closed" || t === "close" || t === "takeover")
					abort(new Error(`SSE stream ${t}`));
			}),
		)
		.then((undo) => {
			if (controller.signal.aborted) void undo();
			else unsubscribe = undo;
		})
		// a broker that cannot be reached cannot say the client left: stop rather than spend blind
		.catch(abort);
	return controller;
}
