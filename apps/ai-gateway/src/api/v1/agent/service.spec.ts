import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as integration from "../../../agent/runner/integration";
import * as queue from "../../../agent/runner/queue";
import * as repo from "../../../agent/runner/repository";
import * as store from "../../../agent/store";
import * as quota from "../harness-conversations/send-message/rateLimit";
import {
	answerApproval,
	getConversationDetail,
	patchConversation,
	removeConversation,
	sendMessage,
} from "./service";

const conv = (over: object = {}) =>
	({ id: "c1", projectId: "p1", archived: false, status: "idle", activeRunId: "r1", metadata: { agent: true, mode: "manual" }, ...over }) as any;

const startRun = spyOn(repo, "startRun").mockResolvedValue("r2");
const setMeta = spyOn(repo, "setMeta").mockResolvedValue(undefined as never);
const claim = spyOn(repo, "claimContinue").mockResolvedValue(true);
const update = spyOn(repo, "updateConversation").mockResolvedValue({} as never);
const del = spyOn(repo, "deleteConversation").mockResolvedValue(undefined as never);
const publish = spyOn(queue, "publishAgentJob").mockResolvedValue(undefined);
const supports = spyOn(integration, "projectSupportsThinking").mockResolvedValue(true);
const spies = [
	startRun,
	setMeta,
	claim,
	update,
	del,
	publish,
	supports,
	spyOn(queue, "purgeRunEvents").mockResolvedValue(undefined as never),
	spyOn(quota, "assertRunQuota").mockResolvedValue(undefined as never),
	spyOn(store, "agentStore").mockReturnValue({ all: async () => [] } as never),
	spyOn(repo, "getRun").mockResolvedValue({ id: "r1" } as never),
];
afterAll(() => {
	for (const s of spies) s.mockRestore();
});
beforeEach(() => {
	for (const s of [startRun, setMeta, update, del, publish]) s.mockClear();
});

describe("mode and effort stick to the conversation", () => {
	it("a message saves its mode and effort and runs with them", async () => {
		await sendMessage(conv(), "u", "hi", "plan", "high");
		expect(startRun).toHaveBeenCalledWith("c1", "hi", "plan", "high");
		expect(publish.mock.calls[0][0]).toMatchObject({ mode: "plan", effort: "high" });
	});

	it("a message without an effort keeps the one the conversation had", async () => {
		await sendMessage(conv({ metadata: { agent: true, mode: "auto", effort: "low" } }), "u", "hi", "auto");
		expect(startRun).toHaveBeenCalledWith("c1", "hi", "auto", "low");
	});

	it("an approval that picks a mode saves it and the job runs in it", async () => {
		await answerApproval(conv(), "u", { approve: true, mode: "auto" });
		expect(setMeta).toHaveBeenCalledWith("c1", { agent: true, mode: "auto" });
		expect(publish.mock.calls[0][0]).toMatchObject({ mode: "auto", approval: { ok: true } });
	});

	it("an approval that picks nothing leaves the settings alone", async () => {
		await answerApproval(conv({ metadata: { agent: true, mode: "auto", effort: "mid" } }), "u", {
			approve: false,
			reason: "no",
		});
		expect(setMeta).not.toHaveBeenCalled();
		expect(publish.mock.calls[0][0]).toMatchObject({ mode: "auto", effort: "mid" });
	});

	it("get-conversation returns the settings and whether the model thinks", async () => {
		const meta = { agent: true, mode: "plan", effort: "mid" };
		expect((await getConversationDetail(conv({ metadata: meta }))).settings).toEqual({
			mode: "plan",
			effort: "mid",
			supportsThinking: true,
		});
		supports.mockResolvedValueOnce(false);
		expect((await getConversationDetail(conv())).settings).toEqual({
			mode: "manual",
			effort: "none",
			supportsThinking: false,
		});
	});
});

describe("rename, pin, archive, delete", () => {
	it("renames and pins", async () => {
		await patchConversation(conv(), { title: "Billing", pinned: true });
		expect(update).toHaveBeenCalledWith("c1", { title: "Billing", pinned: true });
	});

	it("archiving unpins", async () => {
		await patchConversation(conv({ pinned: true }), { archived: true });
		expect(update).toHaveBeenCalledWith("c1", { archived: true, pinned: false });
	});

	it("an archived conversation cannot be pinned", async () => {
		await expect(patchConversation(conv({ archived: true }), { pinned: true })).rejects.toThrow("archived");
		expect(update).not.toHaveBeenCalled();
		await patchConversation(conv({ archived: true }), { archived: false, pinned: true });
		expect(update).toHaveBeenCalledWith("c1", { archived: false, pinned: true });
	});

	it("deletes, but not under a running run", async () => {
		await expect(removeConversation(conv({ status: "running" }))).rejects.toThrow("Stop the run");
		expect(del).not.toHaveBeenCalled();
		expect(await removeConversation(conv())).toEqual({ success: true });
		expect(del).toHaveBeenCalledWith("c1");
	});
});
