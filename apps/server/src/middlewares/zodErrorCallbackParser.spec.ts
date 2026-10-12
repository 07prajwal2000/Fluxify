import { describe, expect, it } from "bun:test";
import type { Context } from "hono";
import { z } from "zod";
import zodErrorCallbackParser from "./zodErrorCallbackParser";

/** A Hono Context stand-in that records the json body and status. */
function capture() {
	const seen: { body?: unknown; status?: number } = {};
	const ctx = {
		json: (body: unknown, status: number) => {
			seen.body = body;
			seen.status = status;
			return new Response();
		},
	} as unknown as Context;
	return { seen, ctx };
}

describe("zodErrorCallbackParser", () => {
	it("names each failing field path and reason (#779)", () => {
		const { seen, ctx } = capture();
		zodErrorCallbackParser(
			{
				success: false,
				target: "json",
				data: {},
				error: [
					{ path: ["name"], message: "Invalid input: expected string, received undefined" },
					{ path: ["graph", "blocks", 3, "type"], message: 'Invalid option: expected one of "a"|"b"' },
				],
			},
			ctx,
		);
		expect(seen.status).toBe(400);
		expect(seen.body).toEqual({
			type: "validation",
			errors: [
				{ field: "name", message: "Invalid input: expected string, received undefined" },
				{ field: "graph.blocks.3.type", message: 'Invalid option: expected one of "a"|"b"' },
			],
		});
	});

	it("reads a ZodError too (@hono/zod-validator feeds one)", () => {
		const { seen, ctx } = capture();
		const result = z.object({ n: z.number() }).safeParse({ n: "x" });
		if (result.success) throw new Error("expected the parse to fail");
		zodErrorCallbackParser({ success: false, target: "json", data: { n: "x" }, error: result.error }, ctx);
		expect(seen.status).toBe(400);
		expect(seen.body).toMatchObject({
			type: "validation",
			errors: [{ field: "n" }],
		});
	});

	it("lets a valid result through", () => {
		const { seen, ctx } = capture();
		expect(zodErrorCallbackParser({ success: true, data: {}, target: "json" }, ctx)).toBeUndefined();
		expect(seen.body).toBeUndefined();
	});
});
