import { beforeEach, describe, expect, it, mock } from "bun:test";

const published: string[] = [];
const withdrawn: string[] = [];
const disabled: string[] = [];
let deletedCount = 1;

mock.module("../../../../../db", () => ({
	db: { transaction: async (cb: any) => await cb({}) },
}));
mock.module("../../../../../db/redis", () => ({
	CHAN_ON_INTEGRATION_CHANGE: "chan:on-integration-change",
	publishMessage: async (chan: string) => void published.push(chan),
}));
mock.module("../repository", () => ({
	deleteIntegration: async () => deletedCount,
}));
mock.module("../../../triggers/repository", () => ({
	findTriggersByIntegration: async () => [
		{ id: "t1", projectId: "p1" },
		{ id: "t2", projectId: "p1" },
	],
	findIntegration: async () => ({ name: "cache" }),
}));
mock.module("../../../triggers/pluginTriggers", () => ({
	pluginTriggersUsing: async () => ["t3"],
}));
mock.module("../../../triggers/service", () => ({
	withdraw: async (projectId: string, id: string) =>
		void withdrawn.push(`${projectId}/${id}`),
	disableTrigger: async (id: string, projectId: string, reason: string) =>
		void disabled.push(`${projectId}/${id}: ${reason}`),
}));

import handleRequest from "../service";
import { NotFoundError } from "../../../../../errors/notFoundError";

beforeEach(() => {
	published.length = 0;
	withdrawn.length = 0;
	disabled.length = 0;
	deletedCount = 1;
});

describe("deleting an integration", () => {
	it("withdraws the triggers that read through it", async () => {
		await handleRequest("p1", "int-1");

		expect(withdrawn).toEqual(["p1/t1", "p1/t2"]);
		// a plugin trigger naming it in a param is kept, switched off
		expect(disabled).toEqual(['p1/t3: integration "cache" was deleted']);
		expect(published).toEqual(["chan:on-integration-change"]);
	});

	it("withdraws nothing when the integration does not exist", async () => {
		deletedCount = 0;

		await expect(handleRequest("p1", "int-1")).rejects.toBeInstanceOf(NotFoundError);
		expect(withdrawn).toEqual([]);
		expect(disabled).toEqual([]);
		expect(published).toEqual([]);
	});
});
