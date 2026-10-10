import { describe, expect, test } from "bun:test";
import { DEV_WORKER_URL, serverEnvSchema } from "../env";

const parse = (value?: string) =>
	serverEnvSchema.shape.DEV_WORKER_URL.safeParse(value);

describe("DEV_WORKER_URL", () => {
	test("is unset by default, so the portal falls back to the project's API address", () => {
		expect(DEV_WORKER_URL).toBeUndefined();
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
