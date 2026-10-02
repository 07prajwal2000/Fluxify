import { beforeEach, describe, expect, it, mock } from "bun:test";
import { BlockTypes } from "@fluxify/blocks";
import { ForbiddenError } from "../../../errors/forbidError";
import { queueIntegrationsCache } from "../../../loaders/integrationsLoader";
import type { CanvasChanges } from "../types";

// lib/edition reads the license from NATS KV; stand in for its gate. The real
// module is spread in: bun's mocks leak across spec files.
let licensed = false;
const edition = { ...(await import("../../../lib/edition")) };
mock.module("../../../lib/edition", () => ({
	...edition,
	assertCanUse: () => {
		if (!licensed) throw new ForbiddenError("External connectors need an enterprise license");
	},
}));

const { assertSendMessageLicensed } = await import("../queueLicense");

function saving(...blocks: { type: string; connection?: string }[]): CanvasChanges {
	return {
		changes: {
			blocks: blocks.map(({ type, connection }, i) => ({
				id: `b${i}`,
				type,
				data: { connection },
				position: { x: 0, y: 0 },
			})),
			edges: [],
		},
		actionsToPerform: { blocks: [], edges: [] },
	} as unknown as CanvasChanges;
}

beforeEach(() => {
	licensed = false;
	queueIntegrationsCache.kafka = { variant: "Kafka" };
	queueIntegrationsCache.sqs = { variant: "SQS" };
});

describe("send message license gate", () => {
	it("refuses a block aimed at an enterprise connector without a license", () => {
		expect(() => assertSendMessageLicensed(saving({ type: BlockTypes.queue_send, connection: "kafka" }))).toThrow(
			"External connectors need an enterprise license",
		);
		expect(() => assertSendMessageLicensed(saving({ type: BlockTypes.queue_send, connection: "sqs" }))).toThrow();
	});

	it("lets it through with a license", () => {
		licensed = true;
		expect(() =>
			assertSendMessageLicensed(saving({ type: BlockTypes.queue_send, connection: "kafka" })),
		).not.toThrow();
	});

	it("lets a Redis integration through in Community", () => {
		// a Redis KV integration is not in the queue cache at all
		expect(() =>
			assertSendMessageLicensed(saving({ type: BlockTypes.queue_send, connection: "redis-kv" })),
		).not.toThrow();
	});

	it("ignores blocks this save does not touch, and other block types", () => {
		expect(() =>
			assertSendMessageLicensed(saving({ type: BlockTypes.kv_raw, connection: "kafka" })),
		).not.toThrow();
		expect(() => assertSendMessageLicensed(saving())).not.toThrow();
	});
});
