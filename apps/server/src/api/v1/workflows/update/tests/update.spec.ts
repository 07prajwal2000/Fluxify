import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const published: string[] = [];

mock.module("../../../../../db", () => ({
	db: { transaction: async (cb: any) => await cb({}) },
}));
mock.module("../../../../../db/redis", () => ({
	CHAN_ON_WORKFLOW_CHANGE: "chan:on-workflow-change",
	publishMessage: async (chan: string) => void published.push(chan),
}));

import * as access from "../../access";
import * as repo from "../repository";
import updateWorkflow from "../service";
import { ConflictError } from "../../../../../errors/conflictError";
import { NotFoundError } from "../../../../../errors/notFoundError";

const acl = [{ projectId: "p1", role: "creator" as const }];

const stored = {
	id: "wf-1",
	name: "nightly report",
	description: null,
	active: true,
	timeoutSeconds: 300,
	tracingEnabled: false,
	recordExecution: false,
	projectId: "p1",
	createdBy: null,
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
	published.length = 0;
	mock.restore();
	spyOn(access, "findWorkflowById").mockResolvedValue(stored as any);
	spyOn(access, "findWorkflowByName").mockResolvedValue(undefined as any);
	spyOn(repo, "updateWorkflowRow").mockResolvedValue(stored as any);
});

describe("update workflow", () => {
	it("patches the row and signals a recompile", async () => {
		const result = await updateWorkflow("wf-1", { active: true }, acl);

		expect(result).toMatchObject({ id: "wf-1", projectId: "p1" });
		// dates leave the API as strings, never Date objects
		expect(result.createdAt).toBe(stored.createdAt.toISOString());
		expect(published).toEqual(["chan:on-workflow-change"]);
	});

	it("reports a missing workflow rather than a bare failure", async () => {
		spyOn(access, "findWorkflowById").mockResolvedValue(undefined as any);

		expect(updateWorkflow("wf-1", { active: true }, acl)).rejects.toThrow(
			NotFoundError,
		);
	});

	it("refuses a rename onto a name already used in the project", async () => {
		spyOn(access, "findWorkflowByName").mockResolvedValue({ id: "other" } as any);

		expect(updateWorkflow("wf-1", { name: "taken" }, acl)).rejects.toThrow(
			ConflictError,
		);
	});
});
