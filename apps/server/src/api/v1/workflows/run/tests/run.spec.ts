import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const enqueued: any[] = [];

mock.module("../../../../../modules/jobs/publisher", () => ({
	enqueueJob: async (job: any) => {
		enqueued.push(job);
		return { ...job, id: "job-1" };
	},
}));

import * as access from "../../access";
import runWorkflow from "../service";
import { BadRequestError } from "../../../../../errors/badRequestError";
import { ForbiddenError } from "../../../../../errors/forbidError";

const acl = [{ projectId: "p1", role: "creator" as const }];
const stored = { id: "wf-1", projectId: "p1", active: true };

beforeEach(() => {
	enqueued.length = 0;
	mock.restore();
	spyOn(access, "findWorkflowById").mockResolvedValue(stored as any);
});

describe("run workflow", () => {
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
		spyOn(access, "findWorkflowById").mockResolvedValue({
			...stored,
			active: false,
		} as any);

		expect(runWorkflow("wf-1", {}, "u1", acl)).rejects.toThrow(BadRequestError);
		expect(enqueued).toEqual([]);
	});

	it("refuses a viewer — running a workflow is a write", async () => {
		expect(
			runWorkflow("wf-1", {}, "u1", [{ projectId: "p1", role: "viewer" }]),
		).rejects.toThrow(ForbiddenError);
		expect(enqueued).toEqual([]);
	});
});
