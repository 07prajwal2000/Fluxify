import { expect, test } from "bun:test";
import type { RecordedSpan } from "@/services/recordings";
import { replayOf } from "./replay";

const entry = (input: unknown, extra: Partial<RecordedSpan> = {}) =>
	({
		seq: 0,
		parentSeq: null,
		blockType: "entrypoint",
		customBlockId: null,
		truncated: false,
		input,
		...extra,
	}) as RecordedSpan;

const request = {
	method: "post",
	url: "http://api.test/orders/7?tag=a&tag=b",
	path: "/orders/7",
	host: "api.test",
	query: { tag: ["a", "b"], page: "2" },
	params: { id: "7" },
	headers: {
		host: "api.test",
		"content-length": "12",
		"content-type": "application/json; charset=utf-8",
		authorization: "Bearer t",
	},
	cookies: {},
	body: { qty: 3 },
};

test("a route's request becomes a playground state: params, query, headers, body", () => {
	const replay = replayOf([entry(request)]);
	expect(replay?.kind).toBe("request");
	if (replay?.kind !== "request") return;
	expect(replay.method).toBe("POST");
	expect(replay.path).toBe("/orders/7");
	const { state } = replay;
	expect(state.pathRows?.map((r) => [r.key, r.value])).toEqual([["id", "7"]]);
	// a repeated query value is one row per value
	expect(state.queryRows?.map((r) => [r.key, r.value])).toEqual([
		["tag", "a"],
		["tag", "b"],
		["page", "2"],
	]);
	// the transport sets host and length again; the type is its own field
	expect(state.headerRows?.map((r) => [r.key, r.value])).toEqual([
		["Content-Type", "application/json"],
		["authorization", "Bearer t"],
	]);
	expect(state.contentType).toBe("application/json");
	expect(JSON.parse(state.requestBody?.raw ?? "")).toEqual({ qty: 3 });
	expect(state.validateBeforeSend).toBe(false);
});

test("a text body is kept as text and a form body is sent as JSON", () => {
	const text = replayOf([
		entry({ ...request, headers: { "content-type": "text/plain" }, body: "hello" }),
	]);
	expect(text?.kind === "request" && text.state.requestBody?.raw).toBe("hello");
	expect(text?.kind === "request" && text.state.contentType).toBe("text/plain");

	const form = replayOf([
		entry({ ...request, headers: { "content-type": "multipart/form-data; boundary=x" } }),
	]);
	expect(form?.kind === "request" && form.state.contentType).toBe("application/json");
});

test("a sandbox request keeps its path without the /_sandbox/<id> prefix", () => {
	const replay = replayOf([entry({ ...request, path: "/_sandbox/sb1/users/1" })]);
	expect(replay?.kind === "request" && replay.path).toBe("/users/1");
	const root = replayOf([entry({ ...request, path: "/_sandbox/sb1" })]);
	expect(root?.kind === "request" && root.path).toBe("/");
});

test("a workflow run replays its payload", () => {
	const replay = replayOf([
		entry({ trigger: { kind: "workflow" }, input: { customerId: "c1" }, events: [] }),
	]);
	expect(replay).toEqual({ kind: "payload", payload: { customerId: "c1" } });
});

test("nothing to replay without a recorded input, or when it was cut to fit", () => {
	expect(replayOf([entry(null)])).toBeNull();
	expect(replayOf([{ ...entry(request), blockType: "jsrunner" }])).toBeNull();
	expect(replayOf([entry(request, { truncated: true })])).toBeNull();
});
