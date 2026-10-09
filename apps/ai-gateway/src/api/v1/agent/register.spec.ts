import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { errorHandler } from "@fluxify/server";
import { Hono } from "hono";
import * as integration from "../../../agent/runner/integration";
import * as repo from "../../../agent/runner/repository";
import type { AgentEvent } from "../../../agent/runner/events";
import { registerAgentRoutes } from "./register";
import * as service from "./service";
import * as stream from "./stream";

// spyOn, not mock.module: module mocks leak into every other spec in the run.
const conv = (over: object = {}) =>
	({ id: "c1", userId: "owner", projectId: "p1", metadata: { agent: true, mode: "manual" }, ...over }) as any;
const spies = [
	spyOn(repo, "getConversation").mockImplementation(async (id) =>
		id === "c1" ? conv() : id === "c-untagged" ? conv({ id, metadata: {} }) : id === "c-other" ? conv({ id, projectId: "p2" }) : undefined,
	),
	spyOn(repo, "getRun").mockImplementation(async (id) =>
		id === "r1" ? ({ id: "r1", conversationId: "c1" } as any) : undefined,
	),
	spyOn(repo, "createConversation").mockResolvedValue(conv()),
	spyOn(repo, "listConversations").mockResolvedValue([]),
	spyOn(integration, "projectSupportsThinking").mockResolvedValue(true),
	spyOn(service, "getConversationDetail").mockResolvedValue({} as any),
	spyOn(service, "getOlderMessages").mockResolvedValue({ messages: [], nextBeforeSeq: null }),
	spyOn(service, "sendMessage").mockResolvedValue({ runId: "r1" }),
	spyOn(service, "answerApproval").mockResolvedValue({ runId: "r1" }),
	spyOn(service, "stopRun").mockResolvedValue({ runId: "r1" }),
	spyOn(service, "patchConversation").mockResolvedValue({} as any),
	spyOn(service, "removeConversation").mockResolvedValue({ success: true }),
	spyOn(stream, "streamRun").mockImplementation(((c: any) => c.text("stream")) as any),
];
afterAll(() => {
	for (const s of spies) s.mockRestore();
});

type Who = { id: string; role?: string; admin?: boolean } | null;
let who: Who;
const app = new Hono();
app.onError(errorHandler);
app.use("*", async (c, next) => {
	c.set("user" as never, (who && { id: who.id, isSystemAdmin: !!who.admin }) as never);
	c.set("acl" as never, (who?.role ? [{ projectId: "p1", role: who.role }] : []) as never);
	await next();
});
registerAgentRoutes(app as never);

const call = (method: string, path: string, body?: object) =>
	app.request(path, {
		method,
		headers: { "content-type": "application/json" },
		body: body && JSON.stringify(body),
	});

const owner = { id: "owner", role: "creator" };
const P = "/agent/p1/conversations";

/** [method, path, body, role it needs] for every endpoint inside a conversation. */
const inConversation: [string, string, object | undefined, "viewer" | "creator"][] = [
	["GET", `${P}/c1`, undefined, "viewer"],
	["POST", `${P}/c1/messages`, { text: "hi" }, "creator"],
	["POST", `${P}/c1/approval`, { approve: true }, "creator"],
	["POST", `${P}/c1/stop`, undefined, "creator"],
	["PATCH", `${P}/c1`, { title: "New name" }, "creator"],
	["DELETE", `${P}/c1`, undefined, "creator"],
];

beforeEach(() => {
	who = owner;
});

describe("agent API auth", () => {
	it("create and list need a project role", async () => {
		who = null;
		expect((await call("POST", P, {})).status).toBe(403);
		expect((await call("GET", P)).status).toBe(403);
		who = { id: "owner", role: "viewer" };
		expect((await call("POST", P, {})).status).toBe(403);
		expect((await call("GET", P)).status).toBe(200);
		who = owner;
		expect((await call("POST", P, {})).status).toBe(201);
	});

	it.each(inConversation)("%s %s: role, ownership and project are checked", async (m, path, body, role) => {
		who = null;
		expect((await call(m, path, body)).status).toBe(403);
		if (role === "creator") {
			who = { id: "owner", role: "viewer" };
			expect((await call(m, path, body)).status).toBe(403);
		}
		who = { id: "someone", role: "creator" };
		expect((await call(m, path, body)).status).toBe(403);
		who = owner;
		expect((await call(m, path.replace("c1", "c-other"), body)).status).toBe(404);
		expect((await call(m, path.replace("c1", "c-untagged"), body)).status).toBe(404);
		expect((await call(m, path.replace("c1", "missing"), body)).status).toBe(404);
		expect((await call(m, path, body)).status).toBeLessThan(300);
		who = { id: "admin", admin: true };
		expect((await call(m, path, body)).status).toBeLessThan(300);
	});

	it("the model info needs a project role", async () => {
		who = null;
		expect((await call("GET", "/agent/p1/model")).status).toBe(403);
		who = { id: "owner", role: "viewer" };
		const res = await call("GET", "/agent/p1/model");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ supportsThinking: true });
	});

	it("a message carries its mode and effort; an approval can pick both", async () => {
		const send = service.sendMessage as any;
		const approve = service.answerApproval as any;
		await call("POST", `${P}/c1/messages`, { text: "hi", mode: "plan", effort: "high" });
		expect(send.mock.calls.at(-1).slice(2)).toEqual(["hi", "plan", "high"]);
		await call("POST", `${P}/c1/messages`, { text: "hi" });
		expect(send.mock.calls.at(-1).slice(2)).toEqual(["hi", "manual", undefined]);
		await call("POST", `${P}/c1/approval`, { approve: true, mode: "auto" });
		expect(approve.mock.calls.at(-1)[2]).toEqual({ approve: true, mode: "auto" });
		await call("POST", `${P}/c1/approval`, { approve: false, reason: "no" });
		expect(approve.mock.calls.at(-1)[2]).toEqual({ approve: false, reason: "no" });
	});

	it("refuses an unknown mode or effort and an empty update", async () => {
		expect((await call("POST", `${P}/c1/messages`, { text: "hi", mode: "yolo" })).status).toBe(400);
		expect((await call("POST", `${P}/c1/messages`, { text: "hi", effort: "max" })).status).toBe(400);
		expect((await call("POST", `${P}/c1/approval`, { approve: true, effort: "x" })).status).toBe(400);
		expect((await call("PATCH", `${P}/c1`, {})).status).toBe(400);
		expect((await call("PATCH", `${P}/c1`, { title: "" })).status).toBe(400);
	});

	it("the stream is for the run's owner only", async () => {
		const path = "/agent/runs/r1/stream?afterSeq=4";
		expect((await call("GET", "/agent/runs/nope/stream")).status).toBe(404);
		who = null;
		expect((await call("GET", path)).status).toBe(403);
		who = { id: "someone", role: "viewer" };
		expect((await call("GET", path)).status).toBe(403);
		who = { id: "owner", role: "viewer" };
		const res = await call("GET", path);
		expect(res.status).toBe(200);
		expect((spies.at(-1) as any).mock.calls.at(-1).slice(1)).toEqual(["r1", 4]);
	});
});

describe("message paging", () => {
	it("beforeSeq pages the messages; a bad one is a 400", async () => {
		expect(await (await call("GET", `${P}/c1?beforeSeq=10`)).json()).toEqual({ messages: [], nextBeforeSeq: null });
		expect(service.getOlderMessages).toHaveBeenLastCalledWith(expect.anything(), 10);
		expect((await call("GET", `${P}/c1?beforeSeq=-1`)).status).toBe(400);
		expect((await call("GET", `${P}/c1?beforeSeq=x`)).status).toBe(400);
	});
});

describe("relay", () => {
	async function* batches(...list: AgentEvent[][]) {
		for (const b of list) yield b;
	}

	it("skips events of loaded messages and stops at done", async () => {
		const out: AgentEvent[] = [];
		const ended = await stream.relay(
			batches(
				[
					{ type: "text", seq: 2, text: "old" },
					{ type: "text", seq: 3, text: "new" },
				],
				[{ type: "done", seq: 3, status: "completed" }],
				[{ type: "text", seq: 9, text: "never read" }],
			),
			2,
			async (e) => void out.push(e),
		);
		expect(ended).toBe(true);
		expect(out.map((e) => (e.type === "text" ? e.text : e.type))).toEqual(["new", "done"]);
	});

	it("reports a source that ended without done", async () => {
		expect(await stream.relay(batches([{ type: "text", seq: 1, text: "x" }]), -1, async () => {})).toBe(
			false,
		);
	});
});
