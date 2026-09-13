import { beforeEach, describe, expect, it } from "bun:test";
import {
	buildRouteParamSnippets,
	clearRegisteredSnippets,
	getRegisteredSnippets,
	registerSnippets,
	toIdentifier,
	unregisterSnippets,
} from "./snippetRegistry";

describe("snippetRegistry", () => {
	beforeEach(() => {
		clearRegisteredSnippets();
	});

	it("registers and unregisters snippets by sourceId", () => {
		registerSnippets("source-1", [
			{
				id: "s1",
				title: "Snippet 1",
				description: "Desc 1",
				category: "custom",
				code: "const a = 1;",
			},
		]);

		expect(getRegisteredSnippets().length).toBe(1);
		expect(getRegisteredSnippets()[0].id).toBe("s1");

		registerSnippets("source-2", [
			{
				id: "s2",
				title: "Snippet 2",
				description: "Desc 2",
				category: "custom",
				code: "const b = 2;",
			},
		]);

		expect(getRegisteredSnippets().length).toBe(2);

		unregisterSnippets("source-1");
		expect(getRegisteredSnippets().length).toBe(1);
		expect(getRegisteredSnippets()[0].id).toBe("s2");

		unregisterSnippets("source-2");
		expect(getRegisteredSnippets().length).toBe(0);
	});

	it("deduplicates snippets across sources with same snippet id", () => {
		registerSnippets("source-1", [
			{
				id: "shared-id",
				title: "Original",
				description: "Desc",
				category: "custom",
				code: "original",
			},
		]);

		registerSnippets("source-2", [
			{
				id: "shared-id",
				title: "Overridden",
				description: "Desc",
				category: "custom",
				code: "overridden",
			},
		]);

		const all = getRegisteredSnippets();
		expect(all.length).toBe(1);
		expect(all[0].title).toBe("Overridden");
	});
});

describe("toIdentifier", () => {
	it("converts hyphenated and special characters to valid JS identifier", () => {
		expect(toIdentifier("user-id")).toBe("user_id");
		expect(toIdentifier("order:status")).toBe("order_status");
		expect(toIdentifier("page")).toBe("page");
		expect(toIdentifier("123abc")).toBe("_123abc");
	});
});

describe("buildRouteParamSnippets", () => {
	it("returns empty array when no params provided", () => {
		expect(buildRouteParamSnippets([], [])).toEqual([]);
		expect(buildRouteParamSnippets()).toEqual([]);
	});

	it("generates query param snippets for defined query parameters", () => {
		const snippets = buildRouteParamSnippets([], ["search", "filter"]);
		expect(snippets.length).toBe(3); // 2 individual + 1 batch "all"

		const searchSnippet = snippets.find((s) => s.id === "query-param-search");
		expect(searchSnippet).toBeDefined();
		expect(searchSnippet?.code).toContain('getQueryParam("search")');

		const allSnippet = snippets.find((s) => s.id === "query-params-all");
		expect(allSnippet).toBeDefined();
		expect(allSnippet?.code).toContain('getQueryParam("search")');
		expect(allSnippet?.code).toContain('getQueryParam("filter")');
	});

	it("generates route param snippets with guard check", () => {
		const snippets = buildRouteParamSnippets(["userId"]);
		expect(snippets.length).toBe(1);
		expect(snippets[0].id).toBe("route-param-userId");
		expect(snippets[0].code).toContain('getRouteParam("userId")');
		expect(snippets[0].code).toContain("Missing required route parameter 'userId'");
	});

	it("combines both route and query params with deduplication", () => {
		const snippets = buildRouteParamSnippets(["id", "id"], ["page", "page"]);
		expect(snippets.length).toBe(2);
		expect(snippets.map((s) => s.id)).toEqual([
			"query-param-page",
			"route-param-id",
		]);
	});
});
