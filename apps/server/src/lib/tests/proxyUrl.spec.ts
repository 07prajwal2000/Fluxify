import { describe, expect, test } from "bun:test";
import { PROXY_URL, serverEnvSchema } from "../env";

const parseProxy = (value?: string) => serverEnvSchema.shape.PROXY_URL.safeParse(value);
const parseLegacy = (value?: string) => serverEnvSchema.shape.DEV_WORKER_URL.safeParse(value);

describe("PROXY_URL", () => {
	// a developer's own .env may set it, so compare with the environment, not a fixed value
	test("is the environment's value without a trailing slash, or unset to fall back to the project's address", () => {
		const raw = process.env.PROXY_URL?.trim().replace(/\/+$/, "");
		expect(PROXY_URL).toBe(raw || undefined);
	});

	test("accepts the proxy's URL, an internal name and an empty value", () => {
		expect(parseProxy("http://localhost:8080").success).toBe(true);
		expect(parseProxy("http://traefik").success).toBe(true);
		expect(parseProxy(undefined).success).toBe(true);
		expect(parseProxy("").success).toBe(true);
	});

	test("rejects a value that is not a URL", () => {
		expect(parseProxy("localhost:8080").success).toBe(false);
		expect(parseProxy("the proxy").success).toBe(false);
	});
});

describe("the renamed DEV_WORKER_URL", () => {
	// the env validator exits on a failed parse, so this is the startup refusal
	test("refuses to start and names PROXY_URL when the old variable is still set", () => {
		const result = parseLegacy("http://localhost:5602");
		if (result.success) throw new Error("expected the old variable to be refused");
		expect(result.error.issues[0]?.message).toContain("PROXY_URL");
	});

	test("accepts it when unset or empty, so only a stale deployment trips", () => {
		expect(parseLegacy(undefined).success).toBe(true);
		expect(parseLegacy("").success).toBe(true);
	});
});
