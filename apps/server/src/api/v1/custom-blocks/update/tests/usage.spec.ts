import { describe, expect, it, mock, spyOn } from "bun:test";

const realDb = { ...(await import("../../../../../db")) };
mock.module("../../../../../db", () => ({
	...realDb,
	db: { transaction: async (cb: (tx: unknown) => unknown) => await cb({}) },
}));
const realRedis = { ...(await import("../../../../../db/redis")) };
mock.module("../../../../../db/redis", () => ({ ...realRedis, publishMessage: mock() }));

const { default: handleRequest } = await import("../service");
const { requestBodySchema } = await import("../dto");
const repo = await import("../repository");
const authCommon = await import("../../../../auth/common");

const user = { id: "u1", isSystemAdmin: false } as any;
const acl = [{ projectId: "p1", role: "creator" as any }];

describe("custom block update: usage (#534)", () => {
	it("never changes usage — it is fixed at create", () => {
		const parsed = requestBodySchema.parse({ label: "Seed", usage: "middleware" });
		expect(parsed).toEqual({ label: "Seed" });
	});

	it("keeps a middleware block free of params", async () => {
		spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
		spyOn(repo, "getCustomBlockById").mockResolvedValue({
			id: "cb1",
			projectId: "p1",
			usage: "middleware",
		} as any);
		const update = spyOn(repo, "updateCustomBlock").mockResolvedValue({ id: "cb1" } as any);
		const inputParams = [{ type: "checkbox", name: "x", label: "X" }] as any;
		await handleRequest("cb1", { inputParams }, user, acl);
		expect(update.mock.calls.at(-1)![1].inputParams).toEqual([]);
	});
});
