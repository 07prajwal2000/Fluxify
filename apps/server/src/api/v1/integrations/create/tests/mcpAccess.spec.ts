import { describe, expect, it, mock } from "bun:test";
import { ForbiddenError } from "../../../../../errors/forbidError";

let storedGroup = "mcp";
mock.module("../../test-existing-connection/repository", () => ({
	getIntegrationById: async () => ({ group: storedGroup }),
}));
// stubbed so another spec's leaked spy on the real one cannot change the answer
mock.module("../../../../auth/common", () => ({
	hasProjectAccess: (_u: unknown, acl: { role: string }[], _p: string, role: string) =>
		acl.some((a) => a.role === role),
}));
const { requireAdminForMcp } = await import("../middleware");

const run = (role: string, method: string, group: string) => {
	storedGroup = group;
	const vars: Record<string, unknown> = {
		user: { isSystemAdmin: false },
		acl: [{ projectId: "p1", role }],
	};
	const ctx = {
		req: {
			method,
			param: (k: string) => (k === "projectId" ? "p1" : "i1"),
			json: async () => ({ group }),
		},
		get: (k: string) => vars[k],
	} as any;
	return requireAdminForMcp(ctx, async () => {});
};

describe("requireAdminForMcp", () => {
	for (const method of ["POST", "PUT", "DELETE"]) {
		it(`${method}: creator is refused for mcp`, async () => {
			await expect(run("creator", method, "mcp")).rejects.toThrow(ForbiddenError);
		});
		it(`${method}: project admin may write mcp`, async () => {
			await run("project_admin", method, "mcp");
		});
		it(`${method}: creator may still write other groups`, async () => {
			await run("creator", method, "database");
		});
	}
});
