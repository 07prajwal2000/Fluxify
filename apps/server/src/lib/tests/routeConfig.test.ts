import { describe, expect, test } from "bun:test";
import {
	acceptedContentTypes,
	bodyModeOf,
	DEFAULT_BODY_MODE,
	DEFAULT_CONTENT_TYPES,
	parseRouteConfig,
	streamBodyConfigError,
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

	test("bodies are buffered unless a route opts into streaming", () => {
		expect(bodyModeOf(null)).toBe(DEFAULT_BODY_MODE);
		expect(bodyModeOf({})).toBe(DEFAULT_BODY_MODE);
		expect(
			parseRouteConfig({
				acceptedContentTypes: ["application/octet-stream"],
				bodyMode: "stream",
			}).bodyMode,
		).toBe("stream");
	});

	test("stream mode without a lone octet-stream type is read as buffered", () => {
		expect(
			bodyModeOf({
				acceptedContentTypes: ["application/json"],
				bodyMode: "stream",
			}),
		).toBe(DEFAULT_BODY_MODE);
		expect(
			bodyModeOf({
				acceptedContentTypes: ["application/octet-stream", "text/plain"],
				bodyMode: "stream",
			}),
		).toBe(DEFAULT_BODY_MODE);
	});

	test("the write-side rule names the incompatible pairing", () => {
		expect(
			streamBodyConfigError(["application/octet-stream"], "stream"),
		).toBeUndefined();
		expect(streamBodyConfigError(["application/json"], "stream")).toContain(
			"application/octet-stream",
		);
		expect(streamBodyConfigError(["application/json"], "buffer")).toBeUndefined();
	});

	test("unknown keys survive a round trip through the parser", () => {
		// route_config is an open bag; parsing must not be the thing that drops
		// a key a newer build wrote.
		expect(
			parseRouteConfig({ acceptedContentTypes: ["text/plain"], future: 1 }),
		).toMatchObject({ acceptedContentTypes: ["text/plain"] });
	});
});
