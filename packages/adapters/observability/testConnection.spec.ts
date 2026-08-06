import { describe, it, expect, afterEach } from "bun:test";
import { OpenTelemetryLogs } from "./openTelemetryLogs";

const config = {
	baseUrl: "http://collector.test/api/default/",
	credentials: { username: "root@example.com", password: "pw" },
	headers: { "X-Tenant": "acme" },
};

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function captureFetch(ok: boolean) {
	const calls: { url: string; init: RequestInit }[] = [];
	globalThis.fetch = ((url: string, init: RequestInit) => {
		calls.push({ url, init });
		return Promise.resolve({ ok } as Response);
	}) as unknown as typeof fetch;
	return calls;
}

describe("OpenTelemetryLogs.TestConnection", () => {
	it("probes the endpoint of the signal it was asked about", async () => {
		const calls = captureFetch(true);
		expect(
			await OpenTelemetryLogs.TestConnection(config, new Map(), "traces"),
		).toBe(true);
		// the trailing slash on baseUrl must not produce a double slash
		expect(calls[0]!.url).toBe("http://collector.test/api/default/v1/traces");
		expect(calls[0]!.init.body).toBe('{"resourceSpans":[]}');
	});

	it("defaults to logs", async () => {
		const calls = captureFetch(true);
		await OpenTelemetryLogs.TestConnection(config, new Map());
		expect(calls[0]!.url).toBe("http://collector.test/api/default/v1/logs");
	});

	it("sends auth and the custom headers", async () => {
		const calls = captureFetch(true);
		await OpenTelemetryLogs.TestConnection(config, new Map(), "metrics");
		const headers = calls[0]!.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Basic ${btoa("root@example.com:pw")}`);
		expect(headers["X-Tenant"]).toBe("acme");
	});

	it("fails on a non-2xx answer", async () => {
		captureFetch(false);
		expect(await OpenTelemetryLogs.TestConnection(config, new Map())).toBe(
			false,
		);
	});

	it("fails when the endpoint is unreachable", async () => {
		globalThis.fetch = (() =>
			Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
		expect(await OpenTelemetryLogs.TestConnection(config, new Map())).toBe(
			false,
		);
	});
});
