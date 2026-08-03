import { describe, it, expect, mock, spyOn, beforeEach, afterAll } from "bun:test";

// The delegated services are stubbed with spyOn, not mock.module: module mocks
// are global for the whole run and would follow these fakes into those
// services' own specs.
import * as createService from "../../../api/v1/routes/create/service";
import * as modifyService from "../../../api/v1/routes/update-partial/service";
import * as deleteService from "../../../api/v1/routes/delete/service";
import * as canvasService from "../../canvas/service";

/** the transaction handle the ops handler must hand down to both services */
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
let canvasFails = false;


import { handleRouteOp } from "../route";

import { RpcError } from "../../../db/natsRpc";
import { NotFoundError } from "../../../errors/notFoundError";

const caller = { userId: "u1", projectIds: ["p1"] };
const routeData = {
	name: "list users",
	path: "/users",
	method: "GET" as const,
	projectId: "0199a000-0000-7000-8000-000000000000",
};
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

describe("fluxify.ops.route", () => {
	// a spy on a default export outlives this file otherwise, and every service
	// stubbed here has its own spec
	afterAll(() => {
		for (const spy of spies) spy.mockRestore();
	});

	beforeEach(() => {
		for (const key of Object.keys(calls)) delete calls[key];
		published.length = 0;
		canvasFails = false;

		stub(createService, "default", 
			async (userId: any, data: any, tx: any) => {
				calls.create = { userId, data, tx };
				return { id: "r-new" };
			},
		);
		stub(modifyService, "default", 
			async (id: any, data: any, acl: any) => {
				calls.modify = { id, data, acl };
				return { id } as any;
			},
		);
		stub(deleteService, "default", 
			async (id: any, acl: any) => {
				calls.remove = { id, acl };
				return "";
			},
		);
		stub(canvasService, "saveCanvas", 
			async (parent: any, data: any, projectIds: any, tx: any) => {
				calls.canvas = { parent, data, projectIds, tx };
				if (canvasFails) throw new Error("canvas boom");
			},
		);
	});

	it("creates a route and its canvas in one transaction", async () => {
		const result = await handleRouteOp(
			{ action: "create", data: routeData, canvas },
			{ userId: "u1", projectIds: [routeData.projectId] },
		);

		expect(result).toEqual({ id: "r-new" } as any);
		// both services get the *same* handle â€” that is what makes it atomic
		// one handle shared by both — that is what makes it atomic
		expect(calls.create.tx).toBeDefined();
		expect(calls.canvas.tx).toBe(calls.create.tx);
		expect(calls.canvas.parent).toEqual({ type: "route", id: "r-new" });
		expect(calls.create.userId).toBe("u1");
		expect(published).toEqual(["chan:on-route-change"]);
	});

	it("creates without a canvas when none is given", async () => {
		await handleRouteOp(
			{ action: "create", data: routeData },
			{ userId: "u1", projectIds: [routeData.projectId] },
		);

		expect(calls.canvas).toBeUndefined();
		expect(published).toEqual(["chan:on-route-change"]);
	});

	it("does not announce a change when the canvas fails", async () => {
		canvasFails = true;

		await handleRouteOp(
			{ action: "create", data: routeData, canvas },
			{ userId: "u1", projectIds: [routeData.projectId] },
		).catch(() => {});

		expect(published).toEqual([]);
	});

	it("refuses to create in a project the caller cannot reach", async () => {
		const err = await handleRouteOp(
			{ action: "create", data: routeData, canvas },
			caller,
		).catch((e) => e);

		expect(err).toBeInstanceOf(RpcError);
		expect(err.code).toBe("FORBIDDEN");
		expect(calls.create).toBeUndefined();
	});

	it("rejects a nameless route before anything is written", async () => {
		const err = await handleRouteOp(
			{ action: "create", data: { ...routeData, name: "" } },
			{ userId: "u1", projectIds: [routeData.projectId] },
		).catch((e) => e);

		expect(err.code).toBe("VALIDATION_FAILED");
		expect(err.details[0].field).toBe("data.name");
		expect(calls.create).toBeUndefined();
	});

	it("modifies partially, leaving absent fields alone", async () => {
		await handleRouteOp(
			{ action: "modify", id: "r-1", data: { active: false } },
			caller,
		);

		expect(calls.modify.data).toEqual({ active: false });
		expect(calls.modify.acl).toEqual([{ projectId: "p1", role: "creator" }]);
	});

	it("deletes through the existing service", async () => {
		expect(await handleRouteOp({ action: "delete", id: "r-1" }, caller)).toEqual(
			{ id: "r-1" } as any,
		);
		expect(calls.remove.id).toBe("r-1");
	});

	it("maps a domain error to a wire code", async () => {
		stub(deleteService, "default", async () => {
			throw new NotFoundError("Route not found");
		});

		const err = await handleRouteOp(
			{ action: "delete", id: "gone" },
			caller,
		).catch((e) => e);

		expect(err.code).toBe("PARENT_NOT_FOUND");
		expect(err.message).toBe("Route not found");
	});
});
