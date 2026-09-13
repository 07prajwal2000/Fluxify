import { describe, expect, it } from "bun:test";
import { API_DOCS, API_DOC_CATEGORIES, getGroupedApiDocs } from "./apiDocsData";
import { REQUEST_RESPONSE_DOCS } from "./apiDocsRequest";

describe("apiDocsData", () => {
	it("contains complete list of API documentation items", () => {
		expect(API_DOCS.length).toBeGreaterThanOrEqual(25);
		expect(REQUEST_RESPONSE_DOCS.length).toBeGreaterThanOrEqual(10);
	});

	it("has valid signatures, categories, and descriptions for all items", () => {
		for (const doc of API_DOCS) {
			expect(doc.id).toBeTruthy();
			expect(doc.name).toBeTruthy();
			expect(doc.signature).toBeTruthy();
			expect(doc.description).toBeTruthy();
			expect(doc.category).toBeTruthy();
		}
	});

	it("contains essential runtime functions and globals", () => {
		const names = API_DOCS.map((d) => d.name);
		expect(names).toContain("input");
		expect(names).toContain("httpRequestMethod");
		expect(names).toContain("httpRequestRoute");
		expect(names).toContain("getQueryParam");
		expect(names).toContain("getRouteParam");
		expect(names).toContain("getHeader");
		expect(names).toContain("getCookie");
		expect(names).toContain("getRequestBody");
		expect(names).toContain("setHeader");
		expect(names).toContain("setCookie");
		expect(names).toContain("getConfig");
		expect(names).toContain("[globalVariable]");
		expect(names).toContain("trigger.data");
		expect(names).toContain("trigger.kind");
		expect(names).toContain("trigger.source");
		expect(names).toContain("trigger.reply");
		expect(names).toContain("trigger.id");
		expect(names).toContain("trigger.meta");
		expect(names).toContain("trigger.connection");
		expect(names).toContain("jwt.sign");
		expect(names).toContain("jwt.verify");
		expect(names).toContain("httpClient.get");
		expect(names).toContain("httpClient.post");
		expect(names).toContain("logger.logInfo");
		expect(names).toContain("dbQuery");
		expect(names).toContain("libs.dayjs");
		expect(names).toContain("libs._");
		expect(names).toContain("libs.zod");
	});

	it("documents trigger variables under variables category", () => {
		const triggerDocs = API_DOCS.filter((d) => d.name.startsWith("trigger."));
		expect(triggerDocs.length).toBe(7);
		for (const doc of triggerDocs) {
			expect(doc.category).toBe("variables");
			expect(doc.example).toBeTruthy();
			expect(doc.description).toBeTruthy();
		}
		const triggerDataDoc = triggerDocs.find((d) => d.name === "trigger.data");
		expect(triggerDataDoc?.example).toContain("trigger.data");
	});

	it("groups API docs by categories properly", () => {
		const groups = getGroupedApiDocs();
		expect(groups.length).toBeGreaterThanOrEqual(8);
		for (const group of groups) {
			expect(group.title).toBeTruthy();
			expect(group.items.length).toBeGreaterThan(0);
		}
	});

	it("filters API docs by query string matching name, signature, description, or category", () => {
		const query = "jwt";
		const filtered = API_DOCS.filter(
			(d) =>
				d.name.toLowerCase().includes(query) ||
				d.signature.toLowerCase().includes(query) ||
				d.description.toLowerCase().includes(query) ||
				d.category.toLowerCase().includes(query),
		);
		expect(filtered.length).toBeGreaterThanOrEqual(3);
		expect(filtered.some((d) => d.name === "jwt.sign")).toBe(true);
		expect(filtered.some((d) => d.name === "jwt.verify")).toBe(true);
		expect(filtered.some((d) => d.name === "jwt.decode")).toBe(true);

		const emptyFiltered = API_DOCS.filter((d) =>
			d.name.toLowerCase().includes("nonexistent_xyz"),
		);
		expect(emptyFiltered.length).toBe(0);
	});
});
