import { expect, test } from "bun:test";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { httpClient, retryDelayMs } from "./http";

/** Fake adapter that answers with the given statuses in order. */
function respond(statuses: number[], retryAfter?: string) {
	let calls = 0;
	const adapter = async (config: InternalAxiosRequestConfig) => {
		const status = statuses[Math.min(calls++, statuses.length - 1)];
		const response = {
			data: {},
			status,
			statusText: "",
			headers: retryAfter ? { "retry-after": retryAfter } : {},
			config,
		};
		if (status >= 400) throw new AxiosError("fail", undefined, config, null, response);
		return response;
	};
	return { adapter, calls: () => calls };
}

test("429 then 200 resolves", async () => {
	const fake = respond([429, 200], "0.01");
	const res = await httpClient.post("/x", {}, { adapter: fake.adapter });
	expect(res.status).toBe(200);
	expect(fake.calls()).toBe(2);
});

test("four 429s reject with the original error", async () => {
	const fake = respond([429], "0.01");
	const err = await httpClient.get("/x", { adapter: fake.adapter }).catch((e) => e);
	expect(err.response.status).toBe(429);
	expect(fake.calls()).toBe(4);
});

test("non-429 errors are not retried", async () => {
	const fake = respond([500]);
	const err = await httpClient.get("/x", { adapter: fake.adapter }).catch((e) => e);
	expect(err.response.status).toBe(500);
	expect(fake.calls()).toBe(1);
});

test("Retry-After is honoured, else exponential backoff", () => {
	for (let i = 0; i < 20; i++) {
		const d = retryDelayMs("1", 3);
		expect(d).toBeGreaterThanOrEqual(1000);
		expect(d).toBeLessThan(1250);
	}
	expect(retryDelayMs(undefined, 1)).toBeGreaterThanOrEqual(250);
	expect(retryDelayMs(undefined, 3)).toBeGreaterThanOrEqual(1000);
	expect(retryDelayMs(undefined, 3)).toBeLessThan(1250);
});
