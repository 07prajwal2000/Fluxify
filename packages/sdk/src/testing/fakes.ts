import type { HttpClient, KvAdapter, Logger, QueueProducer, SseContext } from "../context.js";
import {
	DEFAULT_IDLE_TIMEOUT_MS,
	LeasedResources,
	type LeasedResourcesOptions,
	type ResourceTimer,
} from "../runtime/leasedResources.js";
import { parseHandle, sseData } from "../runtime/sse.js";

/** what a `ctx` field throws when the test did not provide it */
export const notStubbed = (what: string): never => {
	throw new Error(`not stubbed: ctx.${what} (pass it in runBlock's ctx)`);
};

/** a key-value store in memory; `setex` expires on the real clock */
export function memoryKv(): KvAdapter & { entries(): Record<string, string> } {
	const store = new Map<string, { value: string; expiresAt?: number }>();
	const live = (key: string) => {
		const hit = store.get(key);
		if (hit?.expiresAt !== undefined && hit.expiresAt <= Date.now()) store.delete(key);
		return store.get(key);
	};
	return {
		get: async (key) => live(key)?.value ?? null,
		set: async (key, value) => void store.set(key, { value }),
		setex: async (key, seconds, value) =>
			void store.set(key, { value, expiresAt: Date.now() + seconds * 1000 }),
		delete: async (key) => void store.delete(key),
		entries: () =>
			Object.fromEntries([...store.keys()].flatMap((k) => (live(k) ? [[k, live(k)!.value]] : []))),
	};
}

export type SentMessage = Parameters<QueueProducer["send"]>[0][number];

/** a queue producer that accepts every message and keeps it in `sent` */
export function memoryQueue(): QueueProducer & { sent: SentMessage[] } {
	const sent: SentMessage[] = [];
	return {
		sent,
		async send(messages) {
			const results = messages.map((m, i) => {
				sent.push(m);
				return { index: i, ok: true as const, result: {} };
			});
			return results;
		},
		client: async () => notStubbed("queue client()"),
		close: async () => {},
	};
}

/** an HTTP client whose every call throws `not stubbed` */
export const unstubbedHttp = (): HttpClient => {
	const fail = async (): Promise<never> => notStubbed("http");
	return { get: fail, post: fail, put: fail, delete: fail, patch: fail };
};

export type LogEntry = { level: "info" | "warn" | "error"; value: unknown };

export function recordingLogger(logs: LogEntry[] = []): Logger & { logs: LogEntry[] } {
	return {
		logs,
		logInfo: (value) => void logs.push({ level: "info", value }),
		logWarn: (value) => void logs.push({ level: "warn", value }),
		logError: (value) => void logs.push({ level: "error", value }),
	};
}

/** a clock you move by hand, for `testPool({ timer })`: nothing fires until `advance` */
export function manualTimer(): ResourceTimer & { advance(ms: number): void; pending(): number } {
	let now = 0;
	let next = 1;
	const tasks = new Map<number, { at: number; handler: () => void }>();
	return {
		setTimeout(handler, ms) {
			tasks.set(next, { at: now + ms, handler });
			return next++;
		},
		clearTimeout: (handle) => void tasks.delete(handle as number),
		advance(ms) {
			now += ms;
			for (const [id, task] of [...tasks].sort(([, a], [, b]) => a.at - b.at)) {
				if (task.at > now) continue;
				tasks.delete(id);
				task.handler();
			}
		},
		pending: () => tasks.size,
	};
}

/** real timers that never keep the test process alive */
const unrefTimer: ResourceTimer = {
	setTimeout(handler, ms) {
		const t = setTimeout(handler, ms);
		(t as { unref?: () => void }).unref?.();
		return t;
	},
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The clients `ctx.pool` keeps, with a worker's lease rules. Pass one to several
 * `runBlock` calls to see a client reused; `getStats()` and `close()` inspect it.
 */
export const testPool = (options: LeasedResourcesOptions = {}) =>
	new LeasedResources<Promise<unknown>>({
		idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
		timer: unrefTimer,
		...options,
	});
export type TestPool = ReturnType<typeof testPool>;

export type SseEvent = { handle: string; data: string; event?: string; eventId?: string };

export type FakeSse = SseContext & {
	/** what the client would receive: data in its wire form, strings as-is, anything else as JSON */
	sent: SseEvent[];
	/** every `close(handle)` call, in order */
	closed: string[];
	/** plays the client leaving: aborts `signal(handle)` */
	disconnect(handle: string, reason?: unknown): void;
};

/**
 * `ctx.sse` with no broker. `onSend` runs after each recorded event, so a test
 * can `disconnect` mid-stream. After a close or disconnect, sends to that
 * handle are dropped, as a worker drops them.
 */
export function fakeSse(options: { onSend?: (event: SseEvent) => void } = {}): FakeSse {
	const sent: SseEvent[] = [];
	const closed: string[] = [];
	const signals = new Map<string, AbortController>();
	const controller = (handle: string) => {
		parseHandle(handle);
		if (!signals.has(handle)) signals.set(handle, new AbortController());
		return signals.get(handle)!;
	};
	const end = (handle: string, reason: unknown) => {
		const c = controller(handle);
		if (!c.signal.aborted) c.abort(reason);
	};
	return {
		sent,
		closed,
		disconnect: (handle, reason = new Error("SSE stream closed")) => end(handle, reason),
		async send(handle, data, { event, eventId } = {}) {
			if (controller(handle).signal.aborted) return;
			const record: SseEvent = { handle, data: sseData(data) };
			if (event !== undefined) record.event = String(event);
			if (eventId !== undefined) record.eventId = String(eventId);
			sent.push(record);
			options.onSend?.(record);
		},
		async close(handle) {
			closed.push(handle);
			end(handle, new Error("SSE stream close"));
		},
		signal: (handle) => controller(handle).signal,
	};
}
