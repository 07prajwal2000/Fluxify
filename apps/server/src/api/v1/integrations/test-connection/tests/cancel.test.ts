import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

mock.module("../repository", () => ({ getAppConfigs: async () => [] }));
const { testIntegrationConnection } = await import("../service");

// a host that accepts the connection and never answers: a driver waits on it for its own timeout
let blackhole: ReturnType<typeof Bun.listen>;
beforeAll(() => {
	blackhole = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } });
});
afterAll(() => blackhole.stop(true));

const postgres = (timeoutMs: number, abort?: AbortSignal) =>
	testIntegrationConnection(
		"p1",
		"database",
		"PostgreSQL",
		{
			source: "credentials",
			dbType: "PostgreSQL",
			host: "127.0.0.1",
			port: blackhole.port,
			username: "u",
			password: "p",
			database: "d",
		},
		undefined,
		timeoutMs,
		undefined,
		undefined,
		undefined,
		abort,
	);

describe("test connection: cancel", () => {
	it("pressing Cancel on a hanging host answers at once, not after the hook's timeout", async () => {
		const controller = new AbortController();
		const started = Date.now();
		const probe = postgres(10_000, controller.signal);
		setTimeout(() => controller.abort(), 300);
		expect(await probe).toEqual({ success: false, error: "Cancelled" });
		expect(Date.now() - started).toBeLessThan(3_000);
	}, 15_000);

	it("without a signal the probe still reports the hang as a timeout", async () => {
		const result = await postgres(500);
		expect(result.success).toBe(false);
		expect(result.error).toContain("timed out");
	}, 15_000);
});
