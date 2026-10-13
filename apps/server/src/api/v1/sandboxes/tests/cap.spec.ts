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
});
