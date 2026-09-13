import { describe, expect, it } from "bun:test";
import { buildRouteParamTypeLib } from "./routeParamTypes";

describe("buildRouteParamTypeLib", () => {
	it("returns empty string when no params given", () => {
		expect(buildRouteParamTypeLib([], [])).toBe("");
		expect(buildRouteParamTypeLib()).toBe("");
	});

	it("generates ambient declaration for route params", () => {
		const lib = buildRouteParamTypeLib(["userId", "postId"]);
		expect(lib).toContain('declare function getRouteParam(key: "userId" | "postId" | (string & {})): string;');
	});

	it("generates ambient declaration for query params", () => {
		const lib = buildRouteParamTypeLib(undefined, ["page", "per_page"]);
		expect(lib).toContain('declare function getQueryParam(key: "page" | "per_page" | (string & {})): string;');
	});

	it("generates ambient declaration for both route and query params", () => {
		const lib = buildRouteParamTypeLib(["id"], ["limit", "offset"]);
		expect(lib).toContain('declare function getRouteParam(key: "id" | (string & {})): string;');
		expect(lib).toContain('declare function getQueryParam(key: "limit" | "offset" | (string & {})): string;');
	});

	it("deduplicates parameter names and filters empty entries", () => {
		const lib = buildRouteParamTypeLib(["id", "id", ""], ["page", "page"]);
		expect(lib).toContain('declare function getRouteParam(key: "id" | (string & {})): string;');
		expect(lib).toContain('declare function getQueryParam(key: "page" | (string & {})): string;');
	});
});
