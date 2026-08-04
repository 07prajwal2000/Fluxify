import { describe, expect, it } from "bun:test";
import { executionRuntimeEnvironment } from "../executionEnvironment";

describe("executionRuntimeEnvironment", () => {
	it("removes every inherited variable outside Windows", () => {
		expect(executionRuntimeEnvironment({ NATS_TOKEN: "secret", PATH: "/bin" }, "linux")).toEqual({});
	});

	it("keeps only SystemRoot on Windows for Bun networking", () => {
		expect(executionRuntimeEnvironment({
		SystemRoot: "C:\\Windows",
		MASTER_ENCRYPTION_KEY: "secret",
		NATS_TOKEN: "secret",
		PATH: "C:\\Windows\\System32",
	}, "win32")).toEqual({ SystemRoot: "C:\\Windows" });
	});

	it("accepts the uppercase SystemRoot spelling", () => {
		expect(executionRuntimeEnvironment({ SYSTEMROOT: "C:\\Windows" }, "win32")).toEqual({
		SystemRoot: "C:\\Windows",
	});
	});
});
