import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import * as repository from "../repository";
import * as serverModule from "@fluxify/server";
import {
	applyArtifact,
	applySubArtifact,
	getSubArtifact,
	listRunSubArtifacts,
} from "../service";

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
		const artifactSpy = spyOn(repository, "getArtifactSubArtifacts");

		const result = await applySubArtifact("user1", "conv1", "proj1", "route-sub");

		expect(artifactSpy).not.toHaveBeenCalled();
		expect(result?.appliedAt).toBeInstanceOf(Date);
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
});
