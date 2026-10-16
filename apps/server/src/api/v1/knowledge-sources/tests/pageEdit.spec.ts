import { describe, expect, it } from "bun:test";
import {
	getResponseSchema,
	pageBodySchema,
	pageParamSchema,
	sourceSchema,
} from "../dto";

describe("pageBodySchema", () => {
	it("accepts valid markdown within 1,000,000 characters", () => {
		const result = pageBodySchema.safeParse({ markdown: "# Hello World\nSome content" });
		expect(result.success).toBe(true);
	});

	it("accepts markdown up to exactly 1,000,000 characters", () => {
		const result = pageBodySchema.safeParse({ markdown: "a".repeat(1_000_000) });
		expect(result.success).toBe(true);
	});

	it("rejects markdown exceeding 1,000,000 characters", () => {
		const result = pageBodySchema.safeParse({ markdown: "a".repeat(1_000_001) });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain("1000000");
		}
	});

	it("rejects non-string markdown", () => {
		expect(pageBodySchema.safeParse({ markdown: 123 }).success).toBe(false);
		expect(pageBodySchema.safeParse({}).success).toBe(false);
	});
});

describe("pageParamSchema", () => {
	it("parses valid projectId, id, and index", () => {
		const result = pageParamSchema.safeParse({
			projectId: "p1",
			id: "s1",
			index: "0",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.index).toBe("0");
		}
	});
});

describe("response schemas with edited flag and count", () => {
	it("sourceSchema validates with editedCount", () => {
		const sample = {
			id: "src-1",
			name: "docs",
			type: "url" as const,
			url: "https://example.com",
			headers: {},
			selectedPages: [],
			enabled: true,
			pageCount: 3,
			editedCount: 2,
			lastFetchedAt: new Date(),
			lastFetchStatus: "ok",
			lastFetchError: null,
		};
		expect(sourceSchema.safeParse(sample).success).toBe(true);
	});

	it("getResponseSchema validates pages with edited: true", () => {
		const sample = {
			id: "src-1",
			name: "docs",
			type: "url" as const,
			url: "https://example.com",
			headers: {},
			selectedPages: [],
			enabled: true,
			pageCount: 1,
			editedCount: 1,
			lastFetchedAt: null,
			lastFetchStatus: null,
			lastFetchError: null,
			pages: [
				{
					url: "https://example.com/page1",
					markdown: "# Edited page",
					edited: true,
				},
			],
		};
		const result = getResponseSchema.safeParse(sample);
		expect(result.success).toBe(true);
	});
});
