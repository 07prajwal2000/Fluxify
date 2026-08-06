import { describe, it, expect } from "bun:test";
import { flushTelemetry, shutdownTelemetry } from "../flush";

const provider = (rejection: unknown) => ({
	forceFlush: () => Promise.reject(rejection),
	shutdown: () => Promise.reject(rejection),
});

describe("flushTelemetry", () => {
	it("swallows Bun's spurious timeout, which arrives as an array of errors", async () => {
		// the shape BasicTracerProvider.forceFlush actually rejects with — matching
		// against a bare Error here would let the guard silently never fire
		await flushTelemetry(provider([new Error("Request timed out")]) as any);
		await shutdownTelemetry(provider([new Error("Request timed out")]) as any);
	});

	it("still swallows it when the rejection is a bare error", async () => {
		await flushTelemetry(provider(new Error("Request timed out")) as any);
	});

	it("rethrows a real export failure", async () => {
		expect(
			flushTelemetry(provider([new Error("connect ECONNREFUSED")]) as any),
		).rejects.toBeDefined();
		expect(shutdownTelemetry(provider(new Error("bad auth")) as any)).rejects.toThrow(
			"bad auth",
		);
	});

	it("rethrows when only some of the batch is the quirk", async () => {
		expect(
			flushTelemetry(
				provider([new Error("Request timed out"), new Error("503")]) as any,
			),
		).rejects.toBeDefined();
	});

	it("rethrows a non-error rejection instead of treating it as the quirk", async () => {
		// asserted as "did it reject", not on the value: an `undefined` rejection is
		// exactly the case that slips past a `rejects.toBeDefined()` check
		const rejected = async (rejection: unknown) => {
			try {
				await flushTelemetry(provider(rejection) as any);
				return false;
			} catch {
				return true;
			}
		};
		expect(await rejected([])).toBe(true);
		expect(await rejected(undefined)).toBe(true);
	});
});
