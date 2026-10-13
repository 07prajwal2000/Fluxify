import { afterEach, describe, expect, it } from "bun:test";
import { maxSandboxesPerUser } from "../cap";

describe("sandboxes per user cap", () => {
	afterEach(() => delete process.env.MAX_SANDBOX_PER_USER);

	it("defaults to 20 and reads the env override", () => {
		expect(maxSandboxesPerUser()).toBe(20);
		process.env.MAX_SANDBOX_PER_USER = "7";
		expect(maxSandboxesPerUser()).toBe(7);
	});

	it("falls back to the default when the value is not a positive integer", () => {
		process.env.MAX_SANDBOX_PER_USER = "many";
		expect(maxSandboxesPerUser()).toBe(20);
		process.env.MAX_SANDBOX_PER_USER = "0";
		expect(maxSandboxesPerUser()).toBe(20);
	});

	it("uses only the 1..1000 range, falling back outside it", () => {
		process.env.MAX_SANDBOX_PER_USER = "1";
		expect(maxSandboxesPerUser()).toBe(1);
		process.env.MAX_SANDBOX_PER_USER = "1000";
		expect(maxSandboxesPerUser()).toBe(1000);

		for (const out of ["-5", "0", "1.5", "1001", "100000"]) {
			process.env.MAX_SANDBOX_PER_USER = out;
			expect(`${out}: ${maxSandboxesPerUser()}`).toBe(`${out}: 20`);
		}
	});
});
