import { describe, expect, test } from "bun:test";
import {
	acceptedContentTypes,
	DEFAULT_CONTENT_TYPES,
	parseRouteConfig,
} from "../routeConfig";

describe("routeConfig", () => {
	test("a route with no stored config accepts JSON", () => {
		expect(acceptedContentTypes(null)).toEqual(DEFAULT_CONTENT_TYPES);
		expect(acceptedContentTypes({})).toEqual(DEFAULT_CONTENT_TYPES);
	});

	test("stored content types are returned as-is", () => {
		expect(
			acceptedContentTypes({
				acceptedContentTypes: ["multipart/form-data", "application/json"],
			}),
		).toEqual(["multipart/form-data", "application/json"]);
	});

	test("a config written by another build never takes the route down", () => {
		expect(acceptedContentTypes({ acceptedContentTypes: [] })).toEqual(
			DEFAULT_CONTENT_TYPES,
		);
		expect(acceptedContentTypes({ acceptedContentTypes: "json" })).toEqual(
			DEFAULT_CONTENT_TYPES,
		);
		expect(acceptedContentTypes("nonsense")).toEqual(DEFAULT_CONTENT_TYPES);
	});

	test("unknown keys survive a round trip through the parser", () => {
		// route_config is an open bag; parsing must not be the thing that drops
		// a key a newer build wrote.
		expect(
			parseRouteConfig({ acceptedContentTypes: ["text/plain"], future: 1 }),
		).toMatchObject({ acceptedContentTypes: ["text/plain"] });
	});
});
