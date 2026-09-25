import { describe, expect, it, mock } from "bun:test";
import { ForbiddenError } from "../../../../../errors/forbidError";
import { NotFoundError } from "../../../../../errors/notFoundError";
import * as repo from "../repository";
import handleRequest from "../service";

describe("unit tests for project get-by-id", () => {
	it("throws NotFoundError when project does not exist", async () => {
		mock.restore();
		mock.module("../repository", () => ({
			getProjectById: async () => undefined,
		}));

		expect(handleRequest("non-existent", [], true)).rejects.toBeInstanceOf(NotFoundError);
	});

	it("throws NotFoundError when project is hidden", async () => {
		mock.restore();
		mock.module("../repository", () => ({
			getProjectById: async () => ({
				id: "proj-1",
				name: "Hidden Project",
				slug: "hidden-project",
				description: null,
				hidden: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		}));

		expect(handleRequest("proj-1", [], true)).rejects.toBeInstanceOf(NotFoundError);
	});

	it("throws ForbiddenError when user does not have access", async () => {
		mock.restore();
		mock.module("../repository", () => ({
			getProjectById: async () => ({
				id: "proj-1",
				name: "Project 1",
				slug: "project-1",
				description: null,
				hidden: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		}));

		expect(
			handleRequest("proj-1", [{ projectId: "other-proj", role: "viewer" } as any], false),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("returns project when system admin", async () => {
		const now = new Date();
		mock.restore();
		mock.module("../repository", () => ({
			getProjectById: async () => ({
				id: "proj-1",
				name: "Project 1",
				slug: "project-1",
				description: "Desc",
				hidden: false,
				createdAt: now,
				updatedAt: now,
			}),
		}));

		const res = await handleRequest("proj-1", [], true);
		expect(res.id).toBe("proj-1");
		expect(res.name).toBe("Project 1");
		expect(res.createdAt).toBe(now.toISOString());
	});

	it("returns project when in ACL", async () => {
		const now = new Date();
		mock.restore();
		mock.module("../repository", () => ({
			getProjectById: async () => ({
				id: "proj-1",
				name: "Project 1",
				slug: "project-1",
				description: null,
				hidden: false,
				createdAt: now,
				updatedAt: now,
			}),
		}));

		const res = await handleRequest(
			"proj-1",
			[{ projectId: "proj-1", role: "viewer" } as any],
			false,
		);
		expect(res.id).toBe("proj-1");
		expect(res.name).toBe("Project 1");
	});
});
