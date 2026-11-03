import { expect, it } from "bun:test";
import { integrationRegistry } from "../integrations";
import { aiExtraBodySchema } from "../integrations/schemas";
import { BaseAiIntegration } from "./baseAiIntegration";
import { EXTRA_BODY_RESERVED, withExtraBody } from "./extraBody";

it("has nothing to add for no extra body", () => {
	expect(withExtraBody()).toBeUndefined();
	expect(withExtraBody({})).toBeUndefined();
});

it("adds the extras, fills fields the request left empty, and never replaces what it set", () => {
	const transform = withExtraBody({
		reasoning_effort: "low",
		temperature: 0.2,
		chat_template_kwargs: { enable_thinking: true },
	})!;
	const out = transform({
		model: "m",
		messages: [{ role: "user", content: "hi" }],
		temperature: undefined,
		reasoning_effort: undefined,
	});
	expect(out).toEqual({
		model: "m",
		messages: [{ role: "user", content: "hi" }],
		temperature: 0.2,
		reasoning_effort: "low",
		chat_template_kwargs: { enable_thinking: true },
	});
	// a value the request carries beats the same extra
	expect(transform({ model: "m", temperature: 0.9 }).temperature).toBe(0.9);
});

it("drops the fields the caller owns, even if one reaches it", () => {
	const hostile = Object.fromEntries(EXTRA_BODY_RESERVED.map((key) => [key, "injected"]));
	// only a non-reserved extra keeps the transform alive
	const transform = withExtraBody({ ...hostile, keep: 1 })!;
	const out = transform({ model: "m", messages: ["real"], tools: undefined });
	expect(out).toEqual({ model: "m", messages: ["real"], keep: 1 });
	expect(withExtraBody(hostile)).toBeUndefined();
});

it("the schema takes a JSON object and refuses the reserved fields by name", () => {
	expect(aiExtraBodySchema.safeParse({ reasoning_effort: "low", a: { b: [1, null] } }).success).toBe(
		true,
	);
	expect(aiExtraBodySchema.safeParse(undefined).success).toBe(true);
	expect(aiExtraBodySchema.safeParse(["x"]).success).toBe(false);
	for (const key of EXTRA_BODY_RESERVED) {
		const res = aiExtraBodySchema.safeParse({ [key]: 1 });
		expect(res.success).toBe(false);
		expect(JSON.stringify(res.error?.issues)).toContain(key);
	}
});

it("only OpenAI Compatible stores an extra body", () => {
	const row = { apiKey: "sk-test", model: "m", extraBody: { a: 1 } };
	expect(integrationRegistry.require("ai", "OpenAI Compatible").configSchema.safeParse({ ...row, baseUrl: "http://x" }).data?.extraBody).toEqual({ a: 1 });
	// zod drops unknown keys, so the other variants never keep it
	expect(integrationRegistry.require("ai", "OpenAI").configSchema.parse(row)).not.toHaveProperty(
		"extraBody",
	);
});

it("expands cfg: values at any depth and fails on a missing key, leaving the row untouched", () => {
	const stored = { apiKey: "sk-test", model: "m", extraBody: { a: "cfg:A", b: { c: ["cfg:C", 2] } } };
	const config = BaseAiIntegration.ExtractConnectionInfo(stored, new Map([["A", "1"], ["C", "3"]]));
	expect(config.extraBody).toEqual({ a: "1", b: { c: ["3", 2] } });
	expect(stored.extraBody.a).toBe("cfg:A");
	expect(() => BaseAiIntegration.ExtractConnectionInfo(stored, new Map())).toThrow(
		"Extra body value not found",
	);
});
