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
import createWorkflow from "../service";
import { ConflictError } from "../../../../../errors/conflictError";
import { ForbiddenError } from "../../../../../errors/forbidError";
import { NotFoundError } from "../../../../../errors/notFoundError";

const projectId = "0199a000-0000-7000-8000-000000000001";
const acl = [{ projectId, role: "creator" as const }];
const input = { name: "nightly report", projectId, timeoutSeconds: 300 };

beforeEach(() => {
	published.length = 0;
	// spies survive between tests, so their call counts have to be dropped too
	mock.restore();
	spyOn(repo, "projectExists").mockResolvedValue(true);
	spyOn(repo, "insertWorkflow").mockResolvedValue("wf-1");
	spyOn(repo, "seedDefaultBlocks").mockResolvedValue(undefined);
	spyOn(access, "findWorkflowByName").mockResolvedValue(undefined as any);
});

describe("create workflow", () => {
	it("creates a workflow with its starting canvas and signals a compile", async () => {
		const result = await createWorkflow("u1", input, acl);

		expect(result).toEqual({ id: "wf-1" });
		expect(repo.seedDefaultBlocks).toHaveBeenCalled();
		expect(published).toEqual(["chan:on-workflow-change"]);
	});

	it("does not seed blocks when the caller brings its own canvas", async () => {
		await createWorkflow(
			"u1",
			input,
			acl,
			{ transaction: async (cb: any) => await cb({}) } as any,
			"preset-1",
			false,
		);

		expect(repo.seedDefaultBlocks).not.toHaveBeenCalled();
		// inside a transaction owned by the caller: the signal is theirs to publish
		expect(published).toEqual([]);
	});

	it("refuses a duplicate name inside the same project", async () => {
		spyOn(access, "findWorkflowByName").mockResolvedValue({ id: "other" } as any);

		expect(createWorkflow("u1", input, acl)).rejects.toThrow(ConflictError);
	});

	it("refuses a project the caller cannot write to", async () => {
		expect(createWorkflow("u1", input, [])).rejects.toThrow(ForbiddenError);
	});

	it("reports a missing project rather than a foreign key failure", async () => {
		spyOn(repo, "projectExists").mockResolvedValue(false);

		expect(createWorkflow("u1", input, acl)).rejects.toThrow(NotFoundError);
	});
});
