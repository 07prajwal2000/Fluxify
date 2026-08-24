import { describe, expect, it } from "bun:test";
import { formatResponseBody } from "./utils";

describe("formatResponseBody", () => {
	it("pretty-prints valid application/json responses", () => {
		expect(formatResponseBody('{"status":"ok","items":[1,2]}', "application/json; charset=utf-8")).toBe(`{
  "status": "ok",
  "items": [
    1,
    2
  ]
}`);
	});

	it("preserves non-JSON and malformed JSON bodies", () => {
		expect(formatResponseBody('{"status":"ok"}', "text/plain")).toBe('{"status":"ok"}');
		expect(formatResponseBody('{invalid', "application/json")).toBe("{invalid");
	});
});
