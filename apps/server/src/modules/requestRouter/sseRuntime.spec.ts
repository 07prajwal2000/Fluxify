import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { type SseBroker, SseBrokerRegistry } from "@fluxify/adapters/sse";
import { hydrateIntegrations, OWNER_KEY } from "../../loaders/integrationsLoader";
import { configureSse, sseResponse, streamOrResult } from "./sse";
import {
	BAD_HANDLE,
	brokerSource,
	createSseApi,
	NO_BROKER,
	parseEnvelope,
	parseHandle,
	type SseApi,
} from "./sseRuntime";

const PROJECT = "p_sse";

/** in-memory pub/sub with the broker's contract: delivered later, to exact subjects only */
function fakeBroker() {
	const listeners = new Map<string, Set<(message: string) => void>>();
	const published: { subject: string; envelope: any }[] = [];
	const broker: SseBroker = {
		async publish(subject, message) {
			published.push({ subject, envelope: JSON.parse(message) });
			for (const listener of [...(listeners.get(subject) ?? [])])
				queueMicrotask(() => listener(message));
		},
		async subscribe(subject, onMessage) {
			if (!listeners.has(subject)) listeners.set(subject, new Set());
			listeners.get(subject)!.add(onMessage);
			return async () => void listeners.get(subject)?.delete(onMessage);
		},
		async close() {},
	};
	const subscribers = (subject: string) => listeners.get(subject)?.size ?? 0;
	return { broker, published, subscribers };
}

let fake: ReturnType<typeof fakeBroker>;
let server: ReturnType<typeof Bun.serve>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** the same wiring as `serveRoute`: `route` runs with this request's `sse`, and the run lasts until `end` */
function serve(route: (sse: SseApi) => unknown) {
	let end = () => {};
	server = Bun.serve({
		port: 0,
		async fetch(request) {
			const sse = createSseApi({ projectId: PROJECT, request, brokerId: "int_1" });
			const outcome = await streamOrResult(request, server, async () => {
				await route(sse);
				await new Promise<void>((resolve) => {
					end = resolve;
				});
				return {};
			});
			if ("body" in outcome) return sseResponse(outcome.body, new Headers());
			return Response.json(null);
		},
	});
	return { url: `http://localhost:${server.port}`, end: () => end() };
}

async function readUntil(response: Response, done: (text: string) => boolean) {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let text = "";
	while (!done(text)) {
		const { value, done: ended } = await reader.read();
		if (ended) break;
		text += decoder.decode(value);
	}
	return { text, reader };
}

beforeEach(() => {
	mock.restore();
	configureSse({ livenessMs: 60_000 });
	fake = fakeBroker();
	spyOn(SseBrokerRegistry.prototype, "brokerFor").mockImplementation(() => fake.broker);
});
afterEach(() => server?.stop(true));

describe("parseHandle", () => {
	test("splits on the first colon only", () => {
		expect(parseHandle("int_8f2a:conv_123")).toEqual({ integrationId: "int_8f2a", id: "conv_123" });
		expect(parseHandle("int_1:a:b:c")).toEqual({ integrationId: "int_1", id: "a:b:c" });
	});

	test.each([[""], ["conv_123"], [":conv"], ["int_1:"], [42], [undefined], [{}]])(
		"refuses %p",
		(handle) => {
			expect(() => parseHandle(handle)).toThrow(BAD_HANDLE);
		},
	);
});

describe("parseEnvelope", () => {
	test("keeps the four kinds, drops anything else", () => {
		expect(parseEnvelope('{"t":"data","d":"x"}')).toEqual({ t: "data", d: "x" });
		expect(parseEnvelope('{"t":"closed"}')).toEqual({ t: "closed" });
		expect(parseEnvelope('{"t":"other"}')).toBeUndefined();
		expect(parseEnvelope("not json")).toBeUndefined();
		expect(parseEnvelope("null")).toBeUndefined();
	});
});

describe("errors", () => {
	test("a malformed handle throws from send, close and signal", async () => {
		const sse = createSseApi({ projectId: PROJECT });
		await expect(sse.send("nope", "x")).rejects.toThrow(BAD_HANDLE);
		await expect(sse.close("nope")).rejects.toThrow(BAD_HANDLE);
		expect(() => sse.signal("nope")).toThrow(BAD_HANDLE);
	});

	test("connect needs a broker setting, a request and an id", () => {
		const request = new Request("http://x.test/");
		expect(() => createSseApi({ projectId: PROJECT, request }).connect("c")).toThrow(NO_BROKER);
		expect(() => createSseApi({ projectId: PROJECT, brokerId: "int_1" }).connect("c")).toThrow(
			"only be used in a route",
		);
		expect(() =>
			createSseApi({ projectId: PROJECT, request, brokerId: "int_1" }).connect(""),
		).toThrow("needs an id");
	});

	test("connectionId is undefined before connect", () => {
		expect(createSseApi({ projectId: PROJECT }).connectionId).toBeUndefined();
	});
});

describe("brokerSource", () => {
	test("only this project's NATS or Redis integrations (#1019)", () => {
		hydrateIntegrations(PROJECT, {
			queue: { q_nats: { variant: "NATS", servers: "nats://x", [OWNER_KEY]: PROJECT } },
			kv: {
				kv_redis: { variant: "Redis", source: "url", url: "redis://x", [OWNER_KEY]: PROJECT },
				kv_memcached: { variant: "Memcached", [OWNER_KEY]: PROJECT },
			},
		});
		hydrateIntegrations("p_other", {
			kv: { kv_foreign: { variant: "Redis", source: "url", url: "redis://y", [OWNER_KEY]: "p_other" } },
		});
		expect(brokerSource("q_nats", PROJECT)?.kind).toBe("nats");
		expect(brokerSource("kv_redis", PROJECT)?.kind).toBe("redis");
		expect(brokerSource("kv_memcached", PROJECT)).toBeUndefined();
		expect(brokerSource("kv_foreign", PROJECT)).toBeUndefined();
		expect(brokerSource("missing", PROJECT)).toBeUndefined();
	});
});

describe("connect and the owner", () => {
	const subject = `fluxify.sse.${PROJECT}.conv_1`;

	test("returns the handle, takes over, subscribes and delivers sends", async () => {
		let handle: string | undefined;
		const { url } = serve(async (sse) => {
			handle = sse.connect("conv_1");
			expect(sse.connectionId).toBe(handle);
			// right after connect: must not be lost to the subscription still opening
			await sse.send(handle, "first");
			await sse.send(handle, { n: 2 }, { event: "token", eventId: "7" });
		});
		const response = await fetch(url);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const { text, reader } = await readUntil(response, (t) => t.includes('{"n":2}'));
		await reader.cancel();
		expect(handle).toBe("int_1:conv_1");
		expect(text).toContain("data: first\n\n");
		expect(text).toContain('event: token\nid: 7\ndata: {"n":2}\n\n');
		expect(fake.published[0]).toMatchObject({ subject, envelope: { t: "takeover" } });
	});

	test("a close from a producer ends the stream; the owner publishes closed and unsubscribes", async () => {
		const { url } = serve(async (sse) => {
			const handle = sse.connect("conv_1");
			await sse.close(handle);
			await sse.close(handle);
		});
		const { text } = await readUntil(await fetch(url), () => false);
		expect(text).toBe(": open\n\n");
		await sleep(10);
		expect(fake.published.map((p) => p.envelope.t)).toEqual(["takeover", "close", "close", "closed"]);
		expect(fake.subscribers(subject)).toBe(0);
	});

	test("its own takeover does not close it; another's does, without a closed", async () => {
		const { url } = serve(async (sse) => {
			sse.connect("conv_1");
		});
		const response = await fetch(url);
		await sleep(10);
		// as NATS may do: our own takeover arrives on our subscription
		const own = fake.published[0]!.envelope;
		await fake.broker.publish(subject, JSON.stringify(own));
		await sleep(10);
		expect(fake.subscribers(subject)).toBe(1);
		await fake.broker.publish(subject, JSON.stringify({ t: "takeover", by: "someone" }));
		const { text } = await readUntil(response, () => false);
		expect(text).toBe(": open\n\n");
		await sleep(10);
		expect(fake.published.some((p) => p.envelope.t === "closed")).toBe(false);
	});

	test("the client leaving publishes closed, which fires signal", async () => {
		const { url } = serve(async (sse) => {
			sse.connect("conv_1");
		});
		const { reader } = await readUntil(await fetch(url), (t) => t.includes(": open"));
		await sleep(10);
		// watching after connect: the connect's own takeover would abort an earlier watch
		const watcher = createSseApi({ projectId: PROJECT });
		const signal = watcher.signal("int_1:conv_1");
		expect(watcher.signal("int_1:conv_1")).toBe(signal);
		await sleep(1);
		await reader.cancel();
		await until(() => signal.aborted);
		expect(fake.published.at(-1)!.envelope).toEqual({ t: "closed" });
		// a fired signal is replaced, not handed out again
		expect(watcher.signal("int_1:conv_1").aborted).toBe(false);
	});

	test.each(["close", "takeover"])("signal fires on %s", async (t) => {
		const signal = createSseApi({ projectId: PROJECT }).signal(`int_1:conv_${t}`);
		await sleep(1);
		await fake.broker.publish(`fluxify.sse.${PROJECT}.conv_${t}`, JSON.stringify({ t }));
		await until(() => signal.aborted);
	});

	test("the run ending without a held Response closes the stream", async () => {
		const { url, end } = serve(async (sse) => {
			sse.connect("conv_1");
		});
		const response = await fetch(url);
		end();
		const { text } = await readUntil(response, () => false);
		expect(text).toBe(": open\n\n");
	});
});

async function until(check: () => boolean, ms = 2000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out");
		await sleep(5);
	}
}
