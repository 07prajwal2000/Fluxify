import { describe, expect, it } from "bun:test";
import {
	ConversationMsgType,
	conversationMessageSchema,
	conversationSubject,
} from "./notifications";
import type { HarnessStreamEvent } from "./streamTypes";
import { AgentNode } from "./types";

const event: HarnessStreamEvent = {
	conversationId: "conv-1",
	runId: "run-1",
	level: "harness",
	phase: "node_start",
	node: AgentNode.ROUTER,
	status: "Running router",
	runStatus: "routing",
	timestamp: 123,
};

const message = {
	type: ConversationMsgType.HARNESS_EVENT,
	userId: "user-1",
	conversationId: event.conversationId,
	runId: event.runId,
	timestamp: event.timestamp,
	event,
};

describe("conversation pub/sub contract", () => {
	it("builds a per-user subject", () => {
		expect(conversationSubject("user-1")).toBe("conversations.user-1");
	});

	it("accepts a well-formed harness event message", () => {
		expect(conversationMessageSchema.safeParse(message).success).toBe(true);
	});

	it("rejects an unknown message type", () => {
		const parsed = conversationMessageSchema.safeParse({ ...message, type: "nope" });
		expect(parsed.success).toBe(false);
	});

	it("rejects a foreign event payload", () => {
		const parsed = conversationMessageSchema.safeParse({ ...message, event: {} });
		expect(parsed.success).toBe(false);
	});
});
