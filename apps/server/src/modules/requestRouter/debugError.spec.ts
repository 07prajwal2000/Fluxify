import { describe, expect, it } from "bun:test";
import {
	DEBUG_TOKEN_HEADER,
	debugError,
	debugRequested,
	decodeDebugError,
	encodeDebugError,
	routeDebugKey,
	signDebugToken,
	verifyDebugToken,
} from "./debugError";
import type { RequestEnvelope } from "./types";

const key = routeDebugKey(Buffer.alloc(32, 1).toString("base64"));
const route = { projectId: "p1", id: "r1" };
const now = 1_000_000;

describe("debug tokens", () => {
	it("accepts a fresh token for the route it was signed for", () => {
		expect(verifyDebugToken(key, signDebugToken(key, route, now), route, now)).toBe(true);
	});

	it("refuses another route, another project, an expired, a tampered or a far-future token", () => {
		const token = signDebugToken(key, route, now);
		expect(verifyDebugToken(key, token, { ...route, id: "r2" }, now)).toBe(false);
		expect(verifyDebugToken(key, token, { ...route, projectId: "p2" }, now)).toBe(false);
		expect(verifyDebugToken(key, token, route, now + 61_000)).toBe(false);
		expect(verifyDebugToken(key, `${token}x`, route, now)).toBe(false);
		const [, signature] = token.split(".");
		expect(verifyDebugToken(key, `${now + 3_600_000}.${signature}`, route, now)).toBe(false);
		expect(verifyDebugToken(routeDebugKey(Buffer.alloc(32, 2).toString("base64")), token, route, now)).toBe(false);
	});

	it("is off without a master key", () => {
		expect(routeDebugKey(undefined)).toBe("");
		expect(verifyDebugToken("", signDebugToken("", route, now), route, now)).toBe(false);
	});
});

describe("debugRequested", () => {
	const parser = { getRouteId: (path: string) => (path === "/users" ? ({ ...route } as any) : null) };
	const envelope = (headers: Record<string, string>, path = "/users") =>
		({ payload: { method: "GET", path, headers, query: {}, body: null } }) as RequestEnvelope;

	it("turns on for a valid token and hides it from the route's code", () => {
		const env = envelope({ [DEBUG_TOKEN_HEADER]: signDebugToken(key, route), accept: "*/*" });
		expect(debugRequested(env, parser, key)).toBe(true);
		expect(env.payload.headers).toEqual({ accept: "*/*" });
	});

	it("stays off for a forged token, an unmatched path or no header", () => {
		const forged = envelope({ [DEBUG_TOKEN_HEADER]: `${Date.now() + 1_000}.abc` });
		expect(debugRequested(forged, parser, key)).toBe(false);
		expect(forged.payload.headers).toEqual({});
		expect(debugRequested(envelope({ [DEBUG_TOKEN_HEADER]: signDebugToken(key, route) }, "/x"), parser, key)).toBe(false);
		expect(debugRequested(envelope({}), parser, key)).toBe(false);
	});
});

describe("debugError", () => {
	it("keeps the block and the cause a db block wraps, without a stack", () => {
		const driver = Object.assign(new Error('column "emial" does not exist'), { code: "42703" });
		const error = new Error("failed to execute native db block", { cause: driver });
		Object.defineProperty(error, Symbol.for("fluxify.block"), {
			value: { id: "b7", type: "db_native", name: "Load user" },
		});
		expect(debugError(error)).toEqual({
			block: { id: "b7", type: "db_native", name: "Load user" },
			message: "failed to execute native db block",
			detail: 'Error: column "emial" does not exist',
		});
	});

	it("handles a thrown non-error and round-trips through the header", () => {
		const debug = debugError("nope");
		expect(debug).toEqual({ message: "nope" });
		expect(decodeDebugError(encodeDebugError(debug))).toEqual(debug);
		expect(decodeDebugError("%%%")).toBeUndefined();
		expect(decodeDebugError(null)).toBeUndefined();
	});
});
