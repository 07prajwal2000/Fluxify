import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import * as repository from "../repository";
import * as serverModule from "@fluxify/server";
import {
	applySubArtifact,
	getSubArtifact,
	listRunSubArtifacts,
	describeArtifactEvent,
} from "../service";
import { applyArtifact } from "../applyBatch";

mock.module("../repository", () => ({
	getSubArtifactById: mock(),
	listSubArtifactsByRun: mock(),
	getArtifactSubArtifacts: mock(),
	markSubArtifactsApplied: mock(),
	updateSubArtifactPayload: mock(),
	findExistingRouteIds: mock(),
}));

/** Every project write goes over the bus, so the bus is the seam these tests
 *  assert against — nothing here should reach NATS or the database. */
const bus: { call: string; args: any[] }[] = [];
const record =
	(call: string, result?: unknown) =>
	async (...args: any[]) => {
		bus.push({ call, args });
		return result;
	};

mock.module("../opsClient", () => ({
	callerFor: (userId: string, projectId: string) => ({
		userId,
		projectIds: [projectId],
	}),
	createRoute: record("createRoute", { id: "live-route" }),
	createCustomBlock: record("createCustomBlock", { id: "live-custom-block" }),
	modifyCustomBlock: record("modifyCustomBlock", { id: "live-custom-block" }),
	deleteCustomBlock: record("deleteCustomBlock", { id: "live-custom-block" }),
	modifyRoute: record("modifyRoute", { id: "live-route" }),
	deleteRoute: record("deleteRoute", { id: "live-route" }),
	readCanvas: record("readCanvas", { blocks: [], edges: [] }),
	saveCanvas: record("saveCanvas", null),
}));

const routeRow = (over: Record<string, any> = {}) => ({
	id: "route-sub",
	artifactId: "art1",
	kind: "route",
	action: "add",
	appliedAt: null,
	payload: { action: "create", routeId: "route-1" },
	...over,
});

const canvasRow = (over: Record<string, any> = {}) => ({
	id: "canvas-sub",
	artifactId: "art1",
	kind: "canvas",
	action: "changes",
	appliedAt: null,
	payload: { targetType: "route", targetId: "route-1", blocks: [] },
	...over,
});

const customBlockRow = (over: Record<string, any> = {}) => ({
	id: "custom-block-sub",
	artifactId: "art1",
	kind: "custom_block",
	action: "add",
	appliedAt: null,
	payload: {
		action: "create",
		customBlockId: "custom-block-1",
		data: { name: "send_notice", label: "Send Notice", inputParams: [] },
	},
	...over,
});

/** Nothing lives in the project unless a test says so. `spyOn` keeps the same
 *  mock across tests, so call counts must be cleared or they accumulate — and a
 *  test that stubs a bus call to throw leaves that stub in place for every test
 *  after it, silently. Both are reset here rather than ordered around. */
beforeEach(async () => {
	bus.length = 0;
	for (const fn of Object.keys(repository) as (keyof typeof repository)[]) {
		(repository[fn] as any).mockClear?.();
	}
	const opsClient = await import("../opsClient");
	for (const [call, result] of [
		["createRoute", { id: "live-route" }],
		["createCustomBlock", { id: "live-custom-block" }],
	] as const) {
		const spy = spyOn(opsClient, call);
		spy.mockClear();
		spy.mockImplementation(record(call, result) as never);
	}
	spyOn(repository, "findExistingRouteIds").mockResolvedValue(new Set() as never);
	spyOn(repository, "markSubArtifactsApplied").mockImplementation(
		(async (_c: string, ids: string[], appliedAt: Date) =>
			ids.map((id) => ({ id, kind: "route", action: "add", appliedAt }))) as never,
	);
});


describe("Harness Artifacts — applying a whole artifact", () => {
	it("404s an empty/unknown artifact", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([] as never);

		expect(applyArtifact("user1", "conv1", "proj1", "nope")).rejects.toThrow(
			serverModule.NotFoundError,
		);
	});

	it("applies a whole artifact route-first, so its own canvas is satisfied", async () => {
		// Both unapplied — only the ordering makes this legal.
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
			routeRow(),
		] as never);

		const result = await applyArtifact("user1", "conv1", "proj1", "art1");

		expect(result.applied.map((a) => a.id)).toEqual(["route-sub", "canvas-sub"]);
		expect(repository.markSubArtifactsApplied).toHaveBeenCalledWith(
			"conv1",
			["route-sub", "canvas-sub"],
			result.appliedAt,
		);
	});

	it("creates a route and its canvas in one bus call", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
			routeRow(),
		] as never);

		await applyArtifact("user1", "conv1", "proj1", "art1");

		// One call, canvas included: the route must never exist without its blocks
		expect(bus.map((b) => b.call)).toEqual(["createRoute"]);
		const [caller, data, canvas] = bus[0].args;
		expect(caller).toEqual({ userId: "user1", projectIds: ["proj1"] });
		expect(data.projectId).toBe("proj1");
		expect(canvas).toEqual({
			actionsToPerform: { blocks: [], edges: [] },
			changes: { blocks: [], edges: [] },
		});
	});

	it("creates a custom block and its canvas in one bus call", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow({ payload: { targetType: "custom_block", targetId: "custom-block-1", blocks: [] } }),
			customBlockRow(),
		] as never);

		await applyArtifact("user1", "conv1", "proj1", "art1");

		expect(bus.map((b) => b.call)).toEqual(["createCustomBlock"]);
		expect(bus[0]?.args[1]).toEqual(expect.objectContaining({ name: "send_notice", projectId: "proj1" }));
		expect(bus[0]?.args[2]).toEqual(expect.objectContaining({ changes: { blocks: [], edges: [] } }));
		expect(repository.updateSubArtifactPayload).toHaveBeenCalledWith("conv1", "canvas-sub", expect.objectContaining({ targetId: "live-custom-block" }));
	});

	// `rest` is stamped applied unconditionally, so a custom block left in that
	// bucket was reported as applied even when its create had just thrown —
	// the user could not retry it and the chip went green on a failure.
	it("leaves a failed custom block unapplied", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			customBlockRow({
				// rejected by customBlockOpFromPayload before it reaches the bus
				payload: {
					action: "create",
					customBlockId: "custom-block-1",
					data: { name: "Not Snake Case", label: "Bad" },
				},
			}),
		] as never);

		const result = await applyArtifact("user1", "conv1", "proj1", "art1");

		expect(bus.map((b) => b.call)).toEqual([]);
		expect(result.applied.map((a) => a.id)).toEqual([]);
		expect(result.failed.map((f) => f.id)).toEqual(["custom-block-sub"]);
		expect(repository.markSubArtifactsApplied).not.toHaveBeenCalled();
	});

	it("rewrites the agent's invented route id to the one storage chose", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
			routeRow(),
		] as never);

		await applyArtifact("user1", "conv1", "proj1", "art1");

		// Both rows carried "route-1", which never existed anywhere but the model's
		// output — every later read has to find the live route instead.
		expect(repository.updateSubArtifactPayload).toHaveBeenCalledWith(
			"conv1",
			"route-sub",
			expect.objectContaining({ routeId: "live-route" }) as never,
		);
		expect(repository.updateSubArtifactPayload).toHaveBeenCalledWith(
			"conv1",
			"canvas-sub",
			expect.objectContaining({ targetId: "live-route" }) as never,
		);
	});

	it("reads the canvas before saving one onto an existing route", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
		] as never);
		spyOn(repository, "findExistingRouteIds").mockResolvedValue(
			new Set(["route-1"]) as never,
		);

		await applySubArtifact("user1", "conv1", "proj1", "canvas-sub");

		// The read is what tells the normalizer which ids are already real.
		expect(bus.map((b) => b.call)).toEqual(["readCanvas", "saveCanvas"]);
		expect(bus[1].args.slice(1, 3)).toEqual(["route", "route-1"]);
	});

	it("404s a whole artifact whose canvas points at a deleted route", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow({ payload: { targetType: "route", targetId: "route-gone" } }),
			routeRow(),
		] as never);

		expect(applyArtifact("user1", "conv1", "proj1", "art1")).rejects.toThrow(
			serverModule.NotFoundError,
		);
	});

	it("keeps applying after one output fails, and reports what did not land", async () => {
		// Two independent routes; the first cannot be written.
		const bad = routeRow({ id: "route-bad", payload: { action: "create", routeId: "route-bad-id" } });
		const good = routeRow({ id: "route-good", payload: { action: "create", routeId: "route-good-id" } });
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([bad, good] as never);

		const opsClient = await import("../opsClient");
		const createSpy = spyOn(opsClient, "createRoute").mockImplementation((async (
			_caller: any,
			_data: any,
			_canvas: any,
			plannedId?: string,
		) => {
			if (plannedId === "route-bad-id") throw new Error("path already taken");
			return { id: "live-route" };
		}) as never);

		const result = await applyArtifact("user1", "conv1", "proj1", "art1");

		expect(createSpy).toHaveBeenCalledTimes(2);
		expect(result.applied.map((a) => a.id)).toEqual(["route-good"]);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].id).toBe("route-bad");
		expect(result.failed[0].reason).toBe("path already taken");
		// Only what actually landed may be stamped applied — a failed output has
		// to stay applyable by hand.
		expect(repository.markSubArtifactsApplied).toHaveBeenCalledWith(
			"conv1",
			["route-good"],
			expect.any(Date),
		);
	});

	// #272 lets a run reference a custom block it created in the same run. The
	// route then cannot be applied until that block exists — an ordering nothing
	// in either payload records, only the task graph.
	it("applies a custom block before the route that invokes it", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow({ subAgentId: "task-route", dependsOn: ["task-block"] }),
			customBlockRow({ subAgentId: "task-block", dependsOn: [] }),
		] as never);

		const result = await applyArtifact("user1", "conv1", "proj1", "art1");

		expect(bus.map((b) => b.call)).toEqual(["createCustomBlock", "createRoute"]);
		expect(result.applied.map((a) => a.id)).toEqual([
			"custom-block-sub",
			"route-sub",
		]);
	});

	it("skips the route when its custom block could not be created", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow({ subAgentId: "task-route", dependsOn: ["task-block"] }),
			customBlockRow({ subAgentId: "task-block", dependsOn: [] }),
		] as never);

		const opsClient = await import("../opsClient");
		spyOn(opsClient, "createCustomBlock").mockImplementation((async () => {
			throw new Error("name already taken");
		}) as never);

		const result = await applyArtifact("user1", "conv1", "proj1", "art1");

		// The route was never attempted: it would have created a route whose
		// canvas invokes a block that does not exist.
		expect(bus.map((b) => b.call)).toEqual([]);
		expect(result.applied).toHaveLength(0);
		expect(result.failed.find((f) => f.id === "route-sub")?.reason).toBe(
			"its custom block could not be created",
		);
	});

	it("carries the skip down a chain, not just to the first child", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			customBlockRow({ subAgentId: "task-block", dependsOn: [] }),
			routeRow({ subAgentId: "task-route", dependsOn: ["task-block"] }),
			// a second canvas for the route, so it is not inlined into the create
			canvasRow({ subAgentId: "task-canvas-a", dependsOn: ["task-route"] }),
			canvasRow({
				id: "canvas-2",
				subAgentId: "task-canvas-b",
				dependsOn: ["task-route"],
			}),
		] as never);

		const opsClient = await import("../opsClient");
		spyOn(opsClient, "createCustomBlock").mockImplementation((async () => {
			throw new Error("name already taken");
		}) as never);

		const result = await applyArtifact("user1", "conv1", "proj1", "art1");

		expect(result.failed.map((f) => f.id).sort()).toEqual([
			"canvas-2",
			"canvas-sub",
			"custom-block-sub",
			"route-sub",
		]);
		// Two hops from the failure, and still reported against its own parent.
		expect(result.failed.find((f) => f.id === "canvas-2")?.reason).toBe(
			"its route could not be created",
		);
	});

	// Storage namespaces a project block, so the name the canvas has to invoke is
	// not the bare one the run asked for. A canvas saved with the stale name looks
	// fine and resolves to nothing.
	it("rewrites a canvas that invokes the custom block by its pre-storage name", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			customBlockRow({ subAgentId: "task-block", dependsOn: [] }),
			routeRow({ subAgentId: "task-route", dependsOn: ["task-block"] }),
			canvasRow({
				subAgentId: "task-canvas",
				dependsOn: ["task-route"],
				payload: {
					targetType: "route",
					targetId: "route-1",
					blocks: [{ id: "b1", blockType: "custom:send_notice" }],
				},
			}),
		] as never);

		await applyArtifact("user1", "conv1", "proj1", "art1");

		const created = bus.find((b) => b.call === "createRoute");
		expect(JSON.stringify(created?.args[2])).toContain(
			"user_defined.project.send_notice",
		);
		expect(JSON.stringify(created?.args[2])).not.toContain('"custom:send_notice"');
	});

	it("refuses a single apply whose parent is still a proposal, and names it", async () => {
		const route = routeRow({ subAgentId: "task-route", dependsOn: ["task-block"] });
		spyOn(repository, "getSubArtifactById").mockResolvedValue(route as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			route,
			customBlockRow({ subAgentId: "task-block", dependsOn: [] }),
		] as never);

		expect(
			applySubArtifact("user1", "conv1", "proj1", "route-sub"),
		).rejects.toThrow(/custom-block-sub/);
		expect(bus).toHaveLength(0);
	});

	it("allows the single apply once the parent has landed", async () => {
		const route = routeRow({ subAgentId: "task-route", dependsOn: ["task-block"] });
		spyOn(repository, "getSubArtifactById").mockResolvedValue(route as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			route,
			customBlockRow({
				subAgentId: "task-block",
				dependsOn: [],
				appliedAt: new Date(),
			}),
		] as never);

		await applySubArtifact("user1", "conv1", "proj1", "route-sub");

		expect(bus.map((b) => b.call)).toEqual(["createRoute"]);
	});

	it("does not try a canvas whose route could not be created", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow(),
			// a second canvas, so it is not inlined into the route create
			canvasRow(),
			canvasRow({ id: "canvas-2" }),
		] as never);

		const opsClient = await import("../opsClient");
		spyOn(opsClient, "createRoute").mockImplementation((async () => {
			throw new Error("bus down");
		}) as never);

		const result = await applyArtifact("user1", "conv1", "proj1", "art1");

		expect(result.applied).toHaveLength(0);
		// Nothing was pushed for the orphaned canvas.
		expect(bus.map((b) => b.call)).not.toContain("saveCanvas");
		expect(result.failed.map((f) => f.id).sort()).toEqual([
			"canvas-2",
			"canvas-sub",
			"route-sub",
		]);
		expect(
			result.failed.find((f) => f.id === "canvas-2")?.reason,
		).toBe("its route could not be created");
	});
});
