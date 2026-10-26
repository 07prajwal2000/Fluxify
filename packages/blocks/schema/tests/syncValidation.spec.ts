import { describe, expect, spyOn, test } from "bun:test";
import { validationContext } from "../buildZodSchema";
import { compileRequestSchema } from "../schemaParser";

describe("request schemas validate synchronously without a JS rule (#944)", () => {
	test("a JS-free schema never enters the async-local context", async () => {
		const run = spyOn(validationContext, "run");
		const schema = compileRequestSchema({
			dataType: "object",
			properties: [{ key: "url", dataType: "str", required: true }],
		});
		expect((await schema.validate({ url: "x" }, { vars: {} })).success).toBe(true);
		expect((await schema.validate({}, { vars: {} })).success).toBe(false);
		expect(run).not.toHaveBeenCalled();
		run.mockRestore();
	});

	test("a JS rule nested in array items still runs against the request's vars", async () => {
		const schema = compileRequestSchema({
			dataType: "object",
			properties: [
				{
					key: "tags",
					dataType: "arr",
					items: { key: "tag", dataType: "js", js: "return input === allowed;" },
				},
			],
		});
		const vars = { allowed: "a" };
		expect((await schema.validate({ tags: ["a"] }, { vars })).success).toBe(true);
		expect((await schema.validate({ tags: ["b"] }, { vars })).success).toBe(false);
	});
});
