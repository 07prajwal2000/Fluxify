import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const published: string[] = [];
const enqueued: any[] = [];
const dropped: string[] = [];

mock.module("../../../../db", () => ({
	db: { transaction: async (cb: any) => await cb({}) },
}));
mock.module("../../../../db/redis", () => ({
	CHAN_ON_WORKFLOW_CHANGE: "chan:on-workflow-change",
	publishMessage: async (chan: string) => void published.push(chan),
}));
mock.module("../../../../modules/compiler/service", () => ({
	dropWorkflow: async (_projectId: string, id: string) => void dropped.push(id),
}));
mock.module("../../../../modules/jobs/publisher", () => ({
	enqueueJob: async (job: any) => {
		enqueued.push(job);
		return { ...job, id: "job-1" };
	},
}));

import * as repo from "../repository";
import { createWorkflow, deleteWorkflow, updateWorkflow } from "../service";
import runWorkflow from "../run";
import { BadRequestError } from "../../../../errors/badRequestError";
import { ConflictError } from "../../../../errors/conflictError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ValidationError } from "../../../../errors/validationError";

const acl = [{ projectId: "p1", role: "creator" as const }];
const projectId = "0199a000-0000-7000-8000-000000000001";

const stored = {
	id: "wf-1",
	name: "nightly report",
	description: null,
	active: true,
	payloadSchema: null,
	timeoutSeconds: 300,
	tracingEnabled: false,
	recordExecution: false,
	projectId: "p1",
	createdBy: null,
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
};

const input = { name: "nightly report", projectId, timeoutSeconds: 300 };

beforeEach(() => {
	published.length = 0;
	enqueued.length = 0;
	dropped.length = 0;
	// spies survive between tests, so their call counts have to be dropped too
	mock.restore();
	spyOn(repo, "projectExists").mockResolvedValue(true);
	spyOn(repo, "findWorkflowByName").mockResolvedValue(undefined as any);
	spyOn(repo, "insertWorkflow").mockResolvedValue("wf-1");
	spyOn(repo, "seedDefaultBlocks").mockResolvedValue(undefined);
	spyOn(repo, "findWorkflowById").mockResolvedValue(stored as any);
	spyOn(repo, "updateWorkflowRow").mockResolvedValue(stored as any);
	spyOn(repo, "deleteWorkflowRow").mockResolvedValue(undefined);
});

describe("workflow service", () => {
	it("creates a workflow with its starting canvas and signals a compile", async () => {
		const result = await createWorkflow("u1", input, [
			{ projectId, role: "creator" },
		]);

		expect(result).toEqual({ id: "wf-1" });
		expect(repo.seedDefaultBlocks).toHaveBeenCalled();
		expect(published).toEqual(["chan:on-workflow-change"]);
	});

	it("does not seed blocks when the caller brings its own canvas", async () => {
		await createWorkflow(
			"u1",
			input,
			[{ projectId, role: "creator" }],
			{ transaction: async (cb: any) => await cb({}) } as any,
			"preset-1",
			false,
		);

		expect(repo.seedDefaultBlocks).not.toHaveBeenCalled();
		// inside someone else's transaction: the signal is theirs to publish
		expect(published).toEqual([]);
	});

	it("refuses a duplicate name inside the same project", async () => {
		spyOn(repo, "findWorkflowByName").mockResolvedValue({ id: "other" } as any);

		expect(
			createWorkflow("u1", input, [{ projectId, role: "creator" }]),
		).rejects.toThrow(ConflictError);
	});

	it("refuses a project the caller cannot write to", async () => {
		expect(createWorkflow("u1", input, [])).rejects.toThrow(ForbiddenError);
	});

	it("drops the artifact before the row is forgotten", async () => {
		await deleteWorkflow("wf-1", acl);

		// the compiler resolves a project from the row, so this has to happen here
		expect(dropped).toEqual(["wf-1"]);
		expect(published).toEqual(["chan:on-workflow-change"]);
	});

	it("reports a missing workflow rather than a bare failure", async () => {
		spyOn(repo, "findWorkflowById").mockResolvedValue(undefined as any);

		expect(updateWorkflow("wf-1", { active: true }, acl)).rejects.toThrow(
			NotFoundError,
		);
	});
});

describe("workflow run", () => {
	it("queues a job carrying the payload", async () => {
		const result = await runWorkflow("wf-1", { payload: { day: 1 } }, "u1", acl);

		expect(result).toEqual({ id: "job-1", accepted: true });
		expect(enqueued[0]).toMatchObject({
			kind: "workflow",
			projectId: "p1",
			target: "wf-1",
			payload: { day: 1 },
		});
	});

	it("refuses an inactive workflow instead of queueing work nothing will run", async () => {
		spyOn(repo, "findWorkflowById").mockResolvedValue({
			...stored,
			active: false,
		} as any);

		expect(runWorkflow("wf-1", {}, "u1", acl)).rejects.toThrow(BadRequestError);
		expect(enqueued).toEqual([]);
	});

	it("validates the payload against the workflow's schema", async () => {
		spyOn(repo, "findWorkflowById").mockResolvedValue({
			...stored,
			payloadSchema: {
				type: "object",
				properties: { day: { type: "number", required: true } },
			},
		} as any);

		expect(
			runWorkflow("wf-1", { payload: { day: "monday" } }, "u1", acl),
		).rejects.toThrow(ValidationError);
		expect(enqueued).toEqual([]);
	});
});
