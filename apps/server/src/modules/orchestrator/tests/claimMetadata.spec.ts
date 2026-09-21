import { describe, expect, it } from "bun:test";
import { claimMetadataSchema, claimResources, DEFAULT_RESOURCES } from "../claimMetadata";

describe("claim metadata", () => {
	it("gives a claim that set nothing 1 CPU and 1024 MB", () => {
		expect(claimResources({})).toEqual(DEFAULT_RESOURCES);
		expect(claimResources(null)).toEqual({ cpu: 1, memoryMb: 1024 });
	});

	it("keeps the default for whichever half was not set", () => {
		expect(claimResources({ resources: { cpu: 2 } })).toEqual({ cpu: 2, memoryMb: 1024 });
	});

	it("accepts sizes on the steps, and refuses sizes between them or out of range", () => {
		const ok = (resources: object) => claimMetadataSchema.safeParse({ resources }).success;
		expect(ok({ cpu: 1.5, memoryMb: 768 })).toBe(true);
		expect(ok({ cpu: 16, memoryMb: 65_536 })).toBe(true);
		expect(ok({ cpu: 1.25 })).toBe(false);
		expect(ok({ memoryMb: 1000 })).toBe(false);
		expect(ok({ cpu: 0 })).toBe(false);
		expect(ok({ cpu: 16.5 })).toBe(false);
		expect(ok({ memoryMb: 128 })).toBe(false);
	});
});
