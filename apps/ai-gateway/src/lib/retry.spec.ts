import { describe, expect, it } from "bun:test";
import { rateLimitDelayMs } from "./retry";

const rateLimited = (headers?: Record<string, string>) => ({
	statusCode: 429,
	headers,
});

describe("rateLimitDelayMs", () => {
	it("ignores anything that is not a rate limit", () => {
		expect(rateLimitDelayMs({ statusCode: 500 })).toBeNull();
	});

	it("doubles from 5s and caps at a minute", () => {
		const delays = [1, 2, 3, 4, 5].map((attempt) =>
			rateLimitDelayMs(rateLimited(), attempt),
		);
		expect(delays).toEqual([5000, 10000, 20000, 40000, 60000]);
	});

	it("prefers the provider's retry-after", () => {
		expect(rateLimitDelayMs(rateLimited({ "retry-after": "3" }), 3)).toBe(3000);
		expect(rateLimitDelayMs(rateLimited({ "retry-after": "600" }), 1)).toBe(60000);
	});
});
