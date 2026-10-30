/**
 * Server-sent event streams held by this execution process (#1022). A run
 * turns its request into a stream with `openStream`; `serveRoute` then answers
 * with the stream instead of JSON. No broker here: #1023 wires the registry to
 * one (a `send` from any node arrives as `write`, `onClose` publishes `closed`).
 */

export type SseEvent = { data: unknown; event?: string; id?: string };

export interface SseStream {
	readonly id: string;
	readonly closed: boolean;
	/** set by a held Response block (#1024): the run ending does not close the stream */
	held: boolean;
	/** a real message: it resets the liveness timer */
	write(event: SseEvent): void;
	/** idempotent; queued events are still flushed */
	close(): void;
	onClose(listener: () => void): void;
}

/**
 * Bytes one connection may have queued and not yet taken by the socket. 1 MiB
 * is thousands of AI tokens of slack for a slow mobile client, while a client
 * that stopped reading costs at most that much memory before it is dropped.
 */
export const SSE_MAX_QUEUED_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 15_000;

let livenessMs = 60_000;
const streams = new Map<string, SseStream>();
/** what `serveRoute` needs beyond the public handle */
type Opened = { stream: SseStream; body: ReadableStream<Uint8Array>; fail(error: unknown): void };
const openedBy = new WeakMap<Request, Opened>();
const waiting = new WeakMap<Request, (stream: SseStream) => void>();
const asyncRequests = new WeakSet<Request>();
const encoder = new TextEncoder();

/** `SSE_LIVENESS_TIMEOUT`, from the bootstrap: the child cannot read its env */
export function configureSse(options: { livenessMs: number }) {
	livenessMs = options.livenessMs;
}

export function getStream(id: string): SseStream | undefined {
	return streams.get(id);
}

/** the request was answered with a 202, so there is no socket to stream to */
export function refuseStreams(request: Request) {
	asyncRequests.add(request);
}

/** the hook #1023 calls from `sse.connect`: this request becomes an event stream */
export function openStream(id: string, request: Request): SseStream {
	if (asyncRequests.has(request)) throw new Error("SSE cannot be used with async replies");
	if (openedBy.has(request)) throw new Error("This request already opened an SSE stream");
	streams.get(id)?.close();
	const opened = createStream(id, request);
	streams.set(id, opened.stream);
	openedBy.set(request, opened);
	waiting.get(request)?.(opened.stream);
	return opened.stream;
}

/**
 * Runs the route; answers with the stream as soon as the run opens one, so
 * events reach the client while the run is still going. The run's end then
 * closes the stream, with an `error` event first when it failed, unless a held
 * Response block keeps it open.
 */
export async function streamOrResult<T extends { error?: unknown }>(
	request: Request,
	server: { timeout(request: Request, seconds: number): void } | undefined,
	run: () => Promise<T>,
): Promise<{ stream: SseStream; body: ReadableStream } | { result: T }> {
	const streamOpened = new Promise<SseStream>((resolve) => waiting.set(request, resolve));
	// listening before the run starts: it may open the stream synchronously
	const finished = run().then((result) => ({ result }));
	const first = await Promise.race([finished, streamOpened]);
	waiting.delete(request);
	const opened = openedBy.get(request);
	if (!opened) return first as { result: T };
	const { stream, body, fail } = opened;
	finished.then(({ result }) => {
		if (result.error !== undefined) fail(result.error);
		else if (!stream.held) stream.close();
	}, fail);
	// Bun's idle timeout would cut a quiet stream; liveness and heartbeat take over
	server?.timeout(request, 0);
	return { stream, body };
}

export function sseResponse(body: ReadableStream, headers: Headers) {
	headers.set("content-type", "text/event-stream");
	headers.set("cache-control", "no-cache");
	// nginx and similar proxies buffer responses unless told not to
	headers.set("x-accel-buffering", "no");
	return new Response(body, { status: 200, headers });
}

export function encodeEvent({ data, event, id }: SseEvent): string {
	let out = "";
	// a newline in either field would start a forged field or event
	if (event) out += `event: ${event.replace(/[\r\n]/g, "")}\n`;
	if (id !== undefined) out += `id: ${id.replace(/[\r\n]/g, "")}\n`;
	const text = typeof data === "string" ? data : (JSON.stringify(data) ?? "");
	for (const line of text.split(/\r\n|\r|\n/)) out += `data: ${line}\n`;
	return `${out}\n`;
}

function createStream(id: string, request: Request): Opened {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let closed = false;
	let liveness: ReturnType<typeof setTimeout> | undefined;
	const listeners: (() => void)[] = [];

	const end = (dropQueue: boolean) => {
		if (closed) return;
		closed = true;
		clearTimeout(liveness);
		clearInterval(heartbeat);
		request.signal.removeEventListener("abort", onAbort);
		if (streams.get(id) === stream) streams.delete(id);
		try {
			if (dropQueue) controller.error(new Error("SSE client is not reading"));
			else controller.close();
		} catch {}
		for (const listener of listeners) {
			try {
				listener();
			} catch {}
		}
	};
	// over the cap the queue is dropped, not flushed: the client is not reading
	const push = (text: string) => {
		if (closed) return;
		controller.enqueue(encoder.encode(text));
		if ((controller.desiredSize ?? 0) < 0) end(true);
	};
	const resetLiveness = () => {
		clearTimeout(liveness);
		liveness = setTimeout(() => {
			push(encodeEvent({ event: "error", data: { message: "SSE stream timed out" } }));
			end(false);
		}, livenessMs);
	};
	const onAbort = () => end(false);

	const body = new ReadableStream<Uint8Array>(
		{
			start: (c) => {
				controller = c;
			},
			cancel: () => end(false),
		},
		new ByteLengthQueuingStrategy({ highWaterMark: SSE_MAX_QUEUED_BYTES }),
	);
	// Bun sends the headers with the first chunk; a client should not wait for an event
	controller.enqueue(encoder.encode(": open\n\n"));
	// a heartbeat keeps proxies from closing the socket; it never resets liveness
	const heartbeat = setInterval(() => push(": ping\n\n"), Math.min(HEARTBEAT_MS, livenessMs / 2));
	const stream: SseStream = {
		id,
		held: false,
		get closed() {
			return closed;
		},
		write(event) {
			if (closed) return;
			resetLiveness();
			push(encodeEvent(event));
		},
		close: () => end(false),
		onClose(listener) {
			if (closed) listener();
			else listeners.push(listener);
		},
	};
	request.signal.addEventListener("abort", onAbort);
	if (request.signal.aborted) end(false);
	resetLiveness();
	return {
		stream,
		body,
		// the run failed: an `error` event, which is not a real message, then close
		fail(error) {
			const message = error instanceof Error ? error.message : String(error);
			push(encodeEvent({ event: "error", data: { message } }));
			end(false);
		},
	};
}
