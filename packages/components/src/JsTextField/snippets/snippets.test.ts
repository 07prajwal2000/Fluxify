import { describe, expect, it } from "bun:test";
import { DEFAULT_SNIPPETS } from "./defaultSnippets";

describe("defaultSnippets", () => {
	it("contains pagination snippets for DB blocks", () => {
		const offsetSnippet = DEFAULT_SNIPPETS.find(
			(s) => s.id === "pagination-offset-limit",
		);
		expect(offsetSnippet).toBeDefined();
		expect(offsetSnippet?.code).toContain("getQueryParam(\"offset\")");
		expect(offsetSnippet?.code).toContain("getQueryParam(\"per_page\")");

		const pageSnippet = DEFAULT_SNIPPETS.find(
			(s) => s.id === "pagination-page-perpage",
		);
		expect(pageSnippet).toBeDefined();
		expect(pageSnippet?.code).toContain("getQueryParam(\"page\")");
	});

	it("contains param, request, auth, http, and validation snippets", () => {
		const routeParamSnippet = DEFAULT_SNIPPETS.find(
			(s) => s.id === "route-param-required",
		);
		expect(routeParamSnippet).toBeDefined();
		expect(routeParamSnippet?.code).toContain("getRouteParam");

		const jwtSign = DEFAULT_SNIPPETS.find((s) => s.id === "jwt-sign");
		expect(jwtSign).toBeDefined();
		expect(jwtSign?.code).toContain("jwt.sign");

		const jwtVerify = DEFAULT_SNIPPETS.find((s) => s.id === "jwt-verify");
		expect(jwtVerify).toBeDefined();
		expect(jwtVerify?.code).toContain("jwt.verify");

		const httpGet = DEFAULT_SNIPPETS.find((s) => s.id === "http-get");
		expect(httpGet).toBeDefined();
		expect(httpGet?.code).toContain("httpClient.get");

		const setCookie = DEFAULT_SNIPPETS.find((s) => s.id === "set-cookie-auth");
		expect(setCookie).toBeDefined();
		expect(setCookie?.code).toContain("setCookie");

		const zodValidate = DEFAULT_SNIPPETS.find((s) => s.id === "zod-validate");
		expect(zodValidate).toBeDefined();
		expect(zodValidate?.code).toContain('import { z } from "zod"');
		expect(DEFAULT_SNIPPETS.some((s) => s.code.includes("libs."))).toBe(false);

		const dbQuery = DEFAULT_SNIPPETS.find(
			(s) => s.id === "db-parameterized-query",
		);
		expect(dbQuery).toBeDefined();
		expect(dbQuery?.code).toContain("dbQuery");

		const loggerSnippet = DEFAULT_SNIPPETS.find(
			(s) => s.id === "logger-structured-event",
		);
		expect(loggerSnippet).toBeDefined();
		expect(loggerSnippet?.code).toContain("logger.logInfo");

		const jsonSnippet = DEFAULT_SNIPPETS.find((s) => s.id === "json-parse-safe");
		expect(jsonSnippet).toBeDefined();
		expect(jsonSnippet?.code).toContain("JSON.parse");
	});

	it("all snippets have non-empty titles, descriptions, and code", () => {
		for (const snippet of DEFAULT_SNIPPETS) {
			expect(snippet.id).toBeTruthy();
			expect(snippet.title).toBeTruthy();
			expect(snippet.description).toBeTruthy();
			expect(snippet.code).toBeTruthy();
			expect(snippet.category).toBeTruthy();
		}
	});
});
