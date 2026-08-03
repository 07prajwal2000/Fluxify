import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from "bun:test";

// see route.spec.ts for why the delegated services use spyOn, not mock.module
import * as createService from "../../../api/v1/custom-blocks/create/service";
import * as modifyService from "../../../api/v1/custom-blocks/update/service";
import * as deleteService from "../../../api/v1/custom-blocks/delete/service";
import * as canvasService from "../../canvas/service";

const TX = { marker: "outer-tx" };
mock.module("../../../db", () => ({
	// a bun mock, not a plain function: other specs sharing this module mock
	// reach for .mockImplementation on it
	db: { transaction: mock(async (cb: any) => await cb(TX)) },
}));

const published: string[] = [];
mock.module("../../../db/redis", () => ({
	publishMessage: async (chan: string) => {
		published.push(chan);
	},
	CHAN_ON_ROUTE_CHANGE: "chan:on-route-change",
	CHAN_ON_CUSTOM_BLOCK_CHANGE: "chan:on-custom-block-change",
}));

const calls: any = {};

import { handleCustomBlockOp } from "../customBlock";

import { RpcError } from "../../../db/natsRpc";

const projectId = "0199a000-0000-7000-8000-000000000000";
const owner = { userId: "u1", projectIds: [projectId] };
const blockData = { name: "send_sms", label: "Send SMS", projectId };
const canvas = {
	actionsToPerform: { blocks: [], edges: [] },
	changes: {
		blocks: [
			{ id: "b1", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
		],
		edges: [],
	},
};

// Installed per test, never at module scope: every file loads before any test
// runs, so a spy created at load time would be in place for the spied
// services' own specs too.
const spies: any[] = [];
const stub = (mod: any, key: string, impl: any) => {
	const spy = spyOn(mod, key).mockImplementation(impl);
	spies.push(spy);
	return spy;
};

describe("fluxify.ops.custom_block", () => {
	// a spy on a default export outlives this file otherwise, and every service
	// stubbed here has its own spec
	afterAll(() => {
		for (const spy of spies) spy.mockRestore();
	});

	beforeEach(() => {
		for (const key of Object.keys(calls)) delete calls[key];
		published.length = 0;

		stub(createService, "default", 
			async (data: any, tx: any) => {
				calls.create = { data, tx };
				return { id: "cb-new" };
			},
		);
		stub(modifyService, "default", 
			async (id: any, data: any, user: any, acl: any) => {
				calls.modify = { id, data, user, acl };
				return { id };
			},
		);
		stub(deleteService, "default", 
			async (id: any, user: any, acl: any) => {
				calls.remove = { id, user, acl };
				return { id };
			},
		);
		stub(canvasService, "saveCanvas", 
			async (parent: any, data: any, projectIds: any, tx: any) => {
				calls.canvas = { parent, data, projectIds, tx };
			},
		);
	});

	it("creates a custom block and its canvas in one transaction", async () => {
		const result = await handleCustomBlockOp(
			{ action: "create", data: blockData, canvas },
			owner,
		);

		expect(result).toEqual({ id: "cb-new" } as any);
		// one handle shared by both — that is what makes it atomic
		expect(calls.create.tx).toBeDefined();
		expect(calls.canvas.tx).toBe(calls.create.tx);
		expect(calls.canvas.parent).toEqual({ type: "custom_block", id: "cb-new" });
		expect(published).toEqual(["chan:on-custom-block-change"]);
	});

	it("refuses to create in a project the caller cannot reach", async () => {
		const err = await handleCustomBlockOp(
			{ action: "create", data: blockData },
			{ userId: "u1", projectIds: ["other"] },
		).catch((e) => e);

		expect(err).toBeInstanceOf(RpcError);
		expect(err.code).toBe("FORBIDDEN");
		expect(calls.create).toBeUndefined();
	});

	it("rejects a name the block registry cannot hold", async () => {
		const err = await handleCustomBlockOp(
			{ action: "create", data: { ...blockData, name: "Send SMS!" } },
			owner,
		).catch((e) => e);

		expect(err.code).toBe("VALIDATION_FAILED");
		expect(err.details[0].field).toBe("data.name");
	});

	it("modifies partially and passes the caller through", async () => {
		await handleCustomBlockOp(
			{ action: "modify", id: "cb-1", data: { label: "New" } },
			owner,
		);

		expect(calls.modify.data).toEqual({ label: "New" });
		expect(calls.modify.user.id).toBe("u1");
		expect(calls.modify.user.isSystemAdmin).toBe(false);
		expect(calls.modify.acl).toEqual([{ projectId, role: "creator" }]);
	});

	it("deletes through the existing service", async () => {
		await handleCustomBlockOp({ action: "delete", id: "cb-1" }, owner);
		expect(calls.remove.id).toBe("cb-1");
	});
});
