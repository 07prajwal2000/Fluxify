import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const realDb = { ...(await import("../../../../../db")) };
mock.module("../../../../../db", () => ({
	...realDb,
	db: { transaction: async (cb: (tx: unknown) => unknown) => await cb({}) },
}));
const realRedis = { ...(await import("../../../../../db/redis")) };
mock.module("../../../../../db/redis", () => ({ ...realRedis, publishMessage: mock() }));

const { default: handleRequest } = await import("../service");
const repo = await import("../repository");
const authCommon = await import("../../../../auth/common");

const user = { id: "u1", isSystemAdmin: false } as any;
const acl = [{ projectId: "p1", role: "creator" as any }];

describe("custom block update: test-only (#483)", () => {
	beforeEach(() => {
		spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
		spyOn(repo, "updateCustomBlock").mockResolvedValue({ id: "cb1" } as any);
	});

	it("refuses to make a block test-only while a live canvas uses it", async () => {
		spyOn(repo, "getCustomBlockById").mockResolvedValue({
			id: "cb1",
			projectId: "p1",
			name: "seed_users",
			testOnly: false,
		} as any);
		spyOn(repo, "liveCanvasesUsing").mockResolvedValue(['route "Create user"']);
		await expect(handleRequest("cb1", { testOnly: true }, user, acl)).rejects.toThrow(
			'Remove this block from route "Create user" first',
		);
	});

	it("makes it test-only once nothing live uses it", async () => {
		spyOn(repo, "getCustomBlockById").mockResolvedValue({
			id: "cb1",
			projectId: "p1",
			name: "seed_users",
			testOnly: false,
		} as any);
		spyOn(repo, "liveCanvasesUsing").mockResolvedValue([]);
		expect((await handleRequest("cb1", { testOnly: true }, user, acl)).id).toBe("cb1");
	});
});
