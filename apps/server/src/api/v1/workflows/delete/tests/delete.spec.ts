import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const published: string[] = [];
const dropped: string[] = [];

mock.module("../../../../../db", () => ({
	db: { transaction: async (cb: any) => await cb({}) },
}));
mock.module("../../../../../db/redis", () => ({
	CHAN_ON_WORKFLOW_CHANGE: "chan:on-workflow-change",
	publishMessage: async (chan: string) => void published.push(chan),
}));
mock.module("../../../../../modules/compiler/service", () => ({
	dropWorkflow: async (_projectId: string, id: string) => void dropped.push(id),
}));

import * as access from "../../access";
import * as repo from "../repository";
import deleteWorkflow from "../service";
import { NotFoundError } from "../../../../../errors/notFoundError";

const acl = [{ projectId: "p1", role: "creator" as const }];
const stored = { id: "wf-1", projectId: "p1", active: true };

beforeEach(() => {
	published.length = 0;
	dropped.length = 0;
	mock.restore();
	spyOn(access, "findWorkflowById").mockResolvedValue(stored as any);
	spyOn(repo, "deleteWorkflowRow").mockResolvedValue(undefined);
});

describe("delete workflow", () => {
	it("drops the artifact before the row is forgotten", async () => {
		const result = await deleteWorkflow("wf-1", acl);

		expect(result).toEqual({ id: "wf-1" });
		// the compiler resolves a project from the row, so this has to happen here
		expect(dropped).toEqual(["wf-1"]);
		expect(published).toEqual(["chan:on-workflow-change"]);
	});

	it("reports a missing workflow rather than deleting nothing quietly", async () => {
		spyOn(access, "findWorkflowById").mockResolvedValue(undefined as any);

		expect(deleteWorkflow("wf-1", acl)).rejects.toThrow(NotFoundError);
		expect(dropped).toEqual([]);
	});
});
