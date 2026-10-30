import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	configureSse,
	encodeEvent,
	getStream,
	openStream,
	refuseStreams,
	SSE_MAX_QUEUED_BYTES,
	type SseStream,
	sseResponse,
	streamOrResult,
} from "./sse";

type Run = (request: Request) => Promise<{ error?: unknown; data?: unknown; held?: boolean }>;

let server: ReturnType<typeof Bun.serve>;

/** the same wiring as `serveRoute`, around a run the test supplies */
function serve(run: Run, idleTimeout = 10) {
	server = Bun.serve({
		port: 0,
		idleTimeout,
		async fetch(request) {
			const outcome = await streamOrResult(request, server, () => run(request));
			if ("body" in outcome) return sseResponse(outcome.body, new Headers({ "x-route": "kept" }));
			return Response.json(outcome.result.data);
		},
	});
	return `http://localhost:${server.port}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => configureSse({ livenessMs: 60_000 }));
afterEach(() => server?.stop(true));

describe("encodeEvent", () => {
	test("one data line per line of text", () => {
		expect(encodeEvent({ data: "a\nb\r\nc" })).toBe("data: a\ndata: b\ndata: c\n\n");
	});

	test("non-strings are JSON", () => {
		expect(encodeEvent({ data: { n: 1 } })).toBe('data: {"n":1}\n\n');
		expect(encodeEvent({ data: undefined })).toBe("data: \n\n");
	});

	test("event and id, stripped of newlines", () => {
		expect(encodeEvent({ data: "x", event: "token\ndata: forged", id: "7" })).toBe(
			"event: tokendata: forged\nid: 7\ndata: x\n\n",
		);
	});
});

describe("SSE stream", () => {
	test("a run that opens a stream answers with it, keeping the route's headers", async () => {
		const url = serve(async (request) => {
			const stream = openStream("s1", request);
			stream.write({ data: "hello", event: "greet" });
			return {};
		});
		const response = await fetch(url);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("x-accel-buffering")).toBe("no");
		expect(response.headers.get("x-route")).toBe("kept");
		// not held: the run ending closes it
		expect(await response.text()).toBe(": open\n\nevent: greet\ndata: hello\n\n");
		expect(getStream("s1")).toBeUndefined();
	});

	test("a run that throws after opening sends an error event, then closes", async () => {
		const url = serve(async (request) => {
			openStream("s2", request).write({ data: "first" });
			await sleep(20);
			throw new Error("boom");
		});
		expect(await (await fetch(url)).text()).toBe(
			': open\n\ndata: first\n\nevent: error\ndata: {"message":"boom"}\n\n',
		);
	});

	test("a held result (#1024) sends its body as an event and leaves the stream open", async () => {
		let stream: SseStream | undefined;
		const url = serve(async (request) => {
			stream = openStream("s-held", request);
			return { held: true, data: { first: true } };
		});
		const reading = fetch(url).then((response) => response.text());
		await sleep(50);
		expect(stream!.held).toBe(true);
		expect(stream!.closed).toBe(false);
		stream!.write({ data: "later" });
		stream!.close();
		expect(await reading).toBe(': open\n\ndata: {"first":true}\n\ndata: later\n\n');
	});

	test("a held result with no body sends no event", async () => {
		let stream: SseStream | undefined;
		const url = serve(async (request) => {
			stream = openStream("s-held-empty", request);
			return { held: true, data: null };
		});
		const reading = fetch(url).then((response) => response.text());
		await sleep(50);
		stream!.close();
		expect(await reading).toBe(": open\n\n");
	});

	test("held without a stream is a plain JSON reply", async () => {
		const url = serve(async () => ({ held: true, data: { ok: 1 } }));
		const response = await fetch(url);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ ok: 1 });
	});

	test("liveness expiry sends an error event, then closes", async () => {
		configureSse({ livenessMs: 300 });
		const url = serve(async (request) => {
			openStream("s3", request).held = true;
			return {};
		});
		const started = Date.now();
		const text = await (await fetch(url)).text();
		expect(text).toEndWith('event: error\ndata: {"message":"SSE stream timed out"}\n\n');
		expect(Date.now() - started).toBeGreaterThanOrEqual(250);
	});

	test("heartbeats do not reset liveness; real messages do", async () => {
		configureSse({ livenessMs: 400 });
		let stream: SseStream | undefined;
		const url = serve(async (request) => {
			stream = openStream("s4", request);
			stream.held = true;
			return {};
		});
		const started = Date.now();
		const reading = fetch(url).then((response) => response.text());
		await sleep(250);
		stream!.write({ data: "reset" });
		const text = await reading;
		const elapsed = Date.now() - started;
		// heartbeats every 200ms ran, yet only the write pushed expiry to ~650ms
		expect(text).toContain(": ping\n\n");
		expect(text).toContain("data: reset\n\n");
		expect(elapsed).toBeGreaterThanOrEqual(600);
		expect(elapsed).toBeLessThan(1_500);
	});

	test("a client that stops reading is closed at the cap", async () => {
		let stream: SseStream | undefined;
		const url = serve(async (request) => {
			stream = openStream("s5", request);
			stream.held = true;
			return {};
		});
		const response = await fetch(url);
		expect(response.ok).toBe(true);
		const closed = new Promise<void>((resolve) => stream!.onClose(resolve));
		const chunk = "x".repeat(64 * 1024);
		let written = 0;
		// never read the body: the socket fills, then the stream's queue
		while (!stream!.closed && written < 256 * 1024 * 1024) {
			stream!.write({ data: chunk });
			written += chunk.length;
			await sleep(0);
		}
		await closed;
		expect(stream!.closed).toBe(true);
		expect(written).toBeGreaterThan(SSE_MAX_QUEUED_BYTES);
		expect(getStream("s5")).toBeUndefined();
		response.body?.cancel().catch(() => {});
	});

	test("a client disconnect closes, drops the entry and runs onClose", async () => {
		let stream: SseStream | undefined;
		const url = serve(async (request) => {
			stream = openStream("s6", request);
			stream.held = true;
			return {};
		});
		const abort = new AbortController();
		const response = await fetch(url, { signal: abort.signal });
		const reader = response.body!.getReader();
		const closed = new Promise<void>((resolve) => stream!.onClose(resolve));
		stream!.write({ data: "one" });
		await reader.read();
		abort.abort();
		await closed;
		expect(getStream("s6")).toBeUndefined();
		// a write after close is ignored, not thrown
		stream!.write({ data: "late" });
	});

	test("a new stream with an open id replaces the old one", async () => {
		const first = openStream("dup", new Request("http://x/"));
		const second = openStream("dup", new Request("http://x/"));
		expect(first.closed).toBe(true);
		expect(getStream("dup")).toBe(second);
		second.close();
	});

	test("an async (202) request cannot open a stream", () => {
		const request = new Request("http://x/");
		refuseStreams(request);
		expect(() => openStream("s7", request)).toThrow("SSE cannot be used with async replies");
		expect(getStream("s7")).toBeUndefined();
	});

	test("a normal route keeps Bun's idle timeout; an SSE route does not", async () => {
		const url = serve(async (request) => {
			const stream = openStream(new URL(request.url).pathname, request);
			stream.held = true;
			setTimeout(() => {
				stream.write({ data: "late" });
				stream.close();
			}, 7_000);
			return {};
		}, 1);
		// the same quiet body from a route that never opened a stream
		const normal = Bun.serve({
			port: 0,
			idleTimeout: 1,
			fetch: () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(": open\n\n"));
							setTimeout(() => {
								// the idle timeout already cut it: the controller is closed
								try {
									controller.enqueue(new TextEncoder().encode("data: late\n\n"));
									controller.close();
								} catch {}
							}, 7_000);
						},
					}),
				),
		});
		try {
			const [cut, sse] = await Promise.all([
				fetch(`http://localhost:${normal.port}/`)
					.then((response) => response.text())
					.then(
						(text) => text,
						() => "cut",
					),
				fetch(`${url}/sse`).then((response) => response.text()),
			]);
			expect(cut).not.toContain("data: late");
			expect(sse).toContain("data: late\n\n");
		} finally {
			normal.stop(true);
		}
	}, 20_000);
});
