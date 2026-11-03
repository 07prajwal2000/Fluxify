import { expect, test } from "bun:test";
import { parseExtraBody } from "./extraBody";

test("blank text is an empty body", () => {
	expect(parseExtraBody("")).toEqual({ body: {} });
	expect(parseExtraBody("  \n")).toEqual({ body: {} });
});

test("a JSON object parses, nested values included", () => {
	expect(parseExtraBody('{ "a": 1, "b": { "c": [true, null] } }')).toEqual({
		body: { a: 1, b: { c: [true, null] } },
	});
});

test("broken JSON and non-objects give an error and no body", () => {
	for (const text of ['{ "a": ', "[1]", '"x"', "null", "5"]) {
		const out = parseExtraBody(text);
		expect(out).toHaveProperty("error");
		expect(out).not.toHaveProperty("body");
	}
});
