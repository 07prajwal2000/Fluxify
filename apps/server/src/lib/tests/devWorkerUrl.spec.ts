import { describe, expect, test } from "bun:test";
import { DEV_WORKER_URL, serverEnvSchema } from "../env";

const parse = (value?: string) =>
	serverEnvSchema.shape.DEV_WORKER_URL.safeParse(value);

describe("DEV_WORKER_URL", () => {
	// a developer's own .env may set it, so compare with the environment, not a fixed value
	test("is the environment's value without a trailing slash, or unset to fall back to the project's API address", () => {
		const raw = process.env.DEV_WORKER_URL?.trim().replace(/\/+$/, "");
		expect(DEV_WORKER_URL).toBe(raw || undefined);
	});

	test("accepts a full URL and an empty value", () => {
		expect(parse("http://localhost:5602").success).toBe(true);
		expect(parse("https://dev.example.com").success).toBe(true);
		expect(parse(undefined).success).toBe(true);
		expect(parse("").success).toBe(true);
	});

	test("rejects a value that is not a URL", () => {
		expect(parse("localhost:5602").success).toBe(false);
		expect(parse("dev worker").success).toBe(false);
	});
});
