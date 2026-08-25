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
 *  mock across tests, so call counts must be cleared or they accumulate. */
beforeEach(() => {
	bus.length = 0;
	for (const fn of Object.keys(repository) as (keyof typeof repository)[]) {
		(repository[fn] as any).mockClear?.();
	}
	spyOn(repository, "findExistingRouteIds").mockResolvedValue(new Set() as never);
	spyOn(repository, "markSubArtifactsApplied").mockImplementation(
		(async (_c: string, ids: string[], appliedAt: Date) =>
			ids.map((id) => ({ id, kind: "route", action: "add", appliedAt }))) as never,
	);
});

describe("Harness Artifacts Service", () => {
	it("404s an unknown sub-artifact", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(undefined as never);

		expect(getSubArtifact("conv1", "nope")).rejects.toThrow(serverModule.NotFoundError);
	});

	it("lists a run's sub-artifacts without their payloads", async () => {
		const rows = [{ id: "s1", artifactId: "art1", kind: "route" }];
		const listSpy = spyOn(repository, "listSubArtifactsByRun").mockResolvedValue(
			rows as never,
		);

		const result = await listRunSubArtifacts("conv1", "run1");

		expect(listSpy).toHaveBeenCalledWith("conv1", "run1");
		expect(result).toEqual({ subArtifacts: rows } as never);
		expect(JSON.stringify(result)).not.toContain("payload");
	});

	it("applies a route sub-artifact with no dependency check", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(routeRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([] as never);

		const result = await applySubArtifact("user1", "conv1", "proj1", "route-sub");

		expect(bus.map((b) => b.call)).toEqual(["createRoute"]);
		// the planned id travels with the create — the canvas output already
		// names it, so letting storage mint a new one orphans the pair
		expect(bus[0]?.args[3]).toBe("route-1");
		expect(result?.appliedAt).toBeInstanceOf(Date);
	});

	it("does not reapply an already-landed sub-artifact", async () => {
		const appliedAt = new Date();
		spyOn(repository, "getSubArtifactById").mockResolvedValue(
			routeRow({ appliedAt }) as never,
		);

		const result = await applySubArtifact("user1", "conv1", "proj1", "route-sub");

		expect(result?.appliedAt).toBe(appliedAt);
		expect(bus).toHaveLength(0);
		expect(repository.markSubArtifactsApplied).not.toHaveBeenCalled();
	});

	it("creates a route with its paired canvas inline", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(routeRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow(),
			canvasRow({ payload: { targetType: "route", targetId: "route-1", blocks: [{ id: "entry", blockType: "entrypoint" }] } }),
		] as never);
		await applySubArtifact("user1", "conv1", "proj1", "route-sub");

		expect(bus.map((b) => b.call)).toEqual(["createRoute"]);
		expect(bus[0]?.args[2]).toEqual(expect.objectContaining({ changes: expect.objectContaining({ blocks: expect.any(Array) }) }));
	});

	it("creates a custom block with its paired canvas inline", async () => {
		const customCanvas = canvasRow({
			payload: { targetType: "custom_block", targetId: "custom-block-1", blocks: [{ id: "entry", blockType: "entrypoint" }] },
		});
		spyOn(repository, "getSubArtifactById").mockResolvedValue(customBlockRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			customBlockRow(),
			customCanvas,
		] as never);
		const marked = spyOn(repository, "markSubArtifactsApplied");

		await applySubArtifact("user1", "conv1", "proj1", "custom-block-sub");

		expect(bus.map((b) => b.call)).toEqual(["createCustomBlock"]);
		expect(bus[0]?.args[2]).toEqual(expect.objectContaining({ changes: expect.objectContaining({ blocks: expect.any(Array) }) }));
		expect(marked).toHaveBeenCalledWith("conv1", ["canvas-sub"], expect.any(Date));
	});

	it("re-points a canvas sibling at the id storage gave the new route", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(routeRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
		] as never);
		const update = spyOn(repository, "updateSubArtifactPayload");

		await applySubArtifact("user1", "conv1", "proj1", "route-sub");

		// without this the canvas still names the id the agent invented, and every
		// later read of the link — the apply gate included — thinks it is missing
		expect(update).toHaveBeenCalledWith(
			"conv1",
			"canvas-sub",
			expect.objectContaining({ targetId: "live-route" }),
		);
	});

	it("rejects a canvas whose route from this run is not applied yet", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow(),
			canvasRow(),
		] as never);

		expect(applySubArtifact("user1", "conv1", "proj1", "canvas-sub")).rejects.toThrow(
			serverModule.ConflictError,
		);
	});

	it("applies a canvas once its route from this run is applied", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow({ appliedAt: new Date() }),
			canvasRow(),
		] as never);

		const result = await applySubArtifact("user1", "conv1", "proj1", "canvas-sub");

		expect(result?.appliedAt).toBeInstanceOf(Date);
	});

	it("repairs a canvas naming a route id nobody created", async () => {
		// the block builder copies the id out of another agent's output and can
		// get it wrong; the run configured exactly one route, so that is the target
		spyOn(repository, "getSubArtifactById").mockResolvedValue(
			canvasRow({ payload: { targetType: "route", targetId: "hallucinated", blocks: [] } }) as never,
		);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow({ appliedAt: new Date() }),
		] as never);
		const update = spyOn(repository, "updateSubArtifactPayload");

		await applySubArtifact("user1", "conv1", "proj1", "canvas-sub");

		expect(update).toHaveBeenCalledWith(
			"conv1",
			"canvas-sub",
			expect.objectContaining({ targetId: "route-1" }),
		);
		expect(bus.find((b) => b.call === "saveCanvas")?.args[2]).toBe("route-1");
	});

	it("404s a canvas whose pre-existing route is gone from the project", async () => {
		// No sibling route output => the route must already live in the project.
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
		] as never);

		expect(applySubArtifact("user1", "conv1", "proj1", "canvas-sub")).rejects.toThrow(
			serverModule.NotFoundError,
		);
	});

	it("applies a canvas targeting a route that still exists", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
		] as never);
		spyOn(repository, "findExistingRouteIds").mockResolvedValue(
			new Set(["route-1"]) as never,
		);

		const result = await applySubArtifact("user1", "conv1", "proj1", "canvas-sub");

		expect(result?.appliedAt).toBeInstanceOf(Date);
	});

	it("skips the route check for a canvas on a custom block", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(
			canvasRow({
				payload: { targetType: "custom_block", targetId: "cb-1" },
			}) as never,
		);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([] as never);
		const routesSpy = spyOn(repository, "findExistingRouteIds");

		await applySubArtifact("user1", "conv1", "proj1", "canvas-sub");

		expect(routesSpy).not.toHaveBeenCalled();
	});

	it("describes a route the way the user would name it", () => {
		expect(
			describeArtifactEvent({
				id: "route-sub",
				kind: "route",
				action: "add",
				payload: { data: { name: "Get Order", method: "get", path: "/orders/:id" } },
			}),
		).toBe("Created route 'Get Order' (GET /orders/:id)");
	});
});
