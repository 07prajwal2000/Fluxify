import { describe, expect, it } from "bun:test";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * One custom block, three routes, three configurations. What this covers that a
 * block unit spec cannot: the params a caller configures actually reach the
 * callee's graph, the callee's own branching runs, and a response block inside a
 * custom block ends the block rather than the request.
 *
 * No database — the graphs are pure JS, so the fixtures declare `engine: none`
 * and no container starts.
 */

const sign = await loadGraph("custom-blocks/jwt-sign");
const verify = await loadGraph("custom-blocks/jwt-verify");
const strict = await loadGraph("custom-blocks/jwt-verify-strict");

async function issueToken(sub = "user-42") {
	const run = await runGraph(sign, { body: { sub } });
	return run.body.token as string;
}

describe("jwt_ops custom block", () => {
	it("signs a token through the block's sign branch", async () => {
		const run = await runGraph(sign, { body: { sub: "user-42" } });

		expect(run.status).toBe(200);
		expect(run.body.token).toBeString();
		// three segments: the block really produced a JWT, not a stringified object
		expect(run.body.token.split(".")).toHaveLength(3);
	});

	it("runs the callee's blocks inside the caller's trace", async () => {
		const run = await runGraph(sign, { body: { sub: "user-42" } });

		// the custom block's own ids appear between the caller's, which is the
		// only way to tell the block ran from the caller merely returning
		expect(run.executed).toEqual([
			"entry",
			"claims",
			"cb-entry",
			"cb-is-sign",
			"cb-sign",
			"sign",
			"reply",
		]);
		expect(run.spans.every((span) => span.outcome === "success")).toBe(true);
	});

	it("verifies a token it signed, taking the other branch of the same block", async () => {
		const token = await issueToken("user-42");
		const run = await runGraph(verify, { body: { token } });

		expect(run.status).toBe(200);
		expect(run.body.valid).toBe(true);
		expect(run.body.payload).toMatchObject({ sub: "user-42", role: "admin" });
		// the `operation` param picked the verify path, not the sign path
		expect(run.executed).toContain("cb-verify");
		expect(run.executed).not.toContain("cb-sign");
	});

	it("returns valid:false for a bad token when the block is not strict", async () => {
		const run = await runGraph(verify, { body: { token: "not.a.token" } });

		expect(run.status).toBe(200);
		expect(run.body).toEqual({ valid: false, error: "invalid_token" });
		// the guard let it through: no response block ran inside the callee
		expect(run.executed).not.toContain("cb-reject");
	});

	it("ends on the block's own response block when failOnInvalid is set", async () => {
		const run = await runGraph(strict, { body: { token: "not.a.token" } });

		expect(run.status).toBe(401);
		expect(run.body).toEqual({ valid: false, error: "invalid_token" });
		expect(run.executed).toContain("cb-reject");
		// the callee's response ended the callee, not the request — the caller
		// still got to branch on it
		expect(run.executed).toContain("block-refused");
	});

	it("passes a good token straight through the strict route", async () => {
		const token = await issueToken("user-7");
		const run = await runGraph(strict, { body: { token } });

		expect(run.status).toBe(200);
		expect(run.body.payload).toMatchObject({ sub: "user-7" });
		expect(run.executed).not.toContain("cb-reject");
	});

	it("rejects a token signed with a different secret", async () => {
		// the secret lives inside the block; nothing the caller passes can change it
		const foreign = [
			Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
				"base64url",
			),
			Buffer.from(JSON.stringify({ sub: "intruder" })).toString("base64url"),
			"forged",
		].join(".");

		const run = await runGraph(strict, { body: { token: foreign } });
		expect(run.status).toBe(401);
	});

	it("validates the request before any block runs", async () => {
		const run = await runGraph(verify, { body: {} });

		expect(run.status).toBe(400);
		expect(run.executed).toEqual([]);
	});

	it("compiles the caller to an invoke rather than inlining the block", async () => {
		const run = await runGraph(sign, { body: { sub: "user-42" } });

		expect(run.source).toContain('lib.invoke(ctx, "jwt_ops"');
		// the callee's body is compiled once, into the library — not here
		expect(run.source).not.toContain("e2e-custom-block-secret");
	});
});
