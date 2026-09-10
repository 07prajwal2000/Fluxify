import { beforeEach, describe, expect, it, mock } from "bun:test";

const published: string[] = [];
const withdrawn: string[] = [];
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
}));
mock.module("../../../triggers/service", () => ({
	withdraw: async (projectId: string, id: string) =>
		void withdrawn.push(`${projectId}/${id}`),
}));

import handleRequest from "../service";
import { NotFoundError } from "../../../../../errors/notFoundError";

beforeEach(() => {
	published.length = 0;
	withdrawn.length = 0;
	deletedCount = 1;
});

describe("deleting an integration", () => {
	it("withdraws the triggers that read through it", async () => {
		await handleRequest("p1", "int-1");

		expect(withdrawn).toEqual(["p1/t1", "p1/t2"]);
		expect(published).toEqual(["chan:on-integration-change"]);
	});

	it("withdraws nothing when the integration does not exist", async () => {
		deletedCount = 0;

		await expect(handleRequest("p1", "int-1")).rejects.toBeInstanceOf(NotFoundError);
		expect(withdrawn).toEqual([]);
		expect(published).toEqual([]);
	});
});
