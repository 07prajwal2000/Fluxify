import { expect, test } from "bun:test";
import { sampleFrom } from "./sample";

test("a JSON body is a sample, including a bare null", () => {
	expect(sampleFrom({ status: 200, body: '{"a":1}' })).toEqual({ ok: true, sample: { a: 1 } });
	expect(sampleFrom({ status: 200, body: "null" })).toEqual({ ok: true, sample: null });
});

test("no status, no body or a non-JSON body each say why not", () => {
	for (const response of [
		{ status: 0, body: "{}" },
		{ status: 204, body: "" },
		{ status: 200, body: "<html>" },
	]) {
		const result = sampleFrom(response);
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.reason.length).toBeGreaterThan(0);
	}
});
