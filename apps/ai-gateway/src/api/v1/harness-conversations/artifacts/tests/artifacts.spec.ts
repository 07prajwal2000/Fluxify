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
	findExistingRouteIds: mock(),
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

		const result = await applySubArtifact("conv1", "proj1", "route-sub");

		expect(artifactSpy).not.toHaveBeenCalled();
		expect(result?.appliedAt).toBeInstanceOf(Date);
	});

	it("rejects a canvas whose route from this run is not applied yet", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow(),
			canvasRow(),
		] as never);

		expect(applySubArtifact("conv1", "proj1", "canvas-sub")).rejects.toThrow(
			serverModule.ConflictError,
		);
	});

	it("applies a canvas once its route from this run is applied", async () => {
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			routeRow({ appliedAt: new Date() }),
			canvasRow(),
		] as never);

		const result = await applySubArtifact("conv1", "proj1", "canvas-sub");

		expect(result?.appliedAt).toBeInstanceOf(Date);
	});

	it("404s a canvas whose pre-existing route is gone from the project", async () => {
		// No sibling route output => the route must already live in the project.
		spyOn(repository, "getSubArtifactById").mockResolvedValue(canvasRow() as never);
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
		] as never);

		expect(applySubArtifact("conv1", "proj1", "canvas-sub")).rejects.toThrow(
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

		const result = await applySubArtifact("conv1", "proj1", "canvas-sub");

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

		await applySubArtifact("conv1", "proj1", "canvas-sub");

		expect(routesSpy).not.toHaveBeenCalled();
	});

	it("404s an empty/unknown artifact", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([] as never);

		expect(applyArtifact("conv1", "proj1", "nope")).rejects.toThrow(
			serverModule.NotFoundError,
		);
	});

	it("applies a whole artifact route-first, so its own canvas is satisfied", async () => {
		// Both unapplied — only the ordering makes this legal.
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow(),
			routeRow(),
		] as never);

		const result = await applyArtifact("conv1", "proj1", "art1");

		expect(result.applied.map((a) => a.id)).toEqual(["route-sub", "canvas-sub"]);
		expect(repository.markSubArtifactsApplied).toHaveBeenCalledWith(
			"conv1",
			["route-sub", "canvas-sub"],
			result.appliedAt,
		);
	});

	it("404s a whole artifact whose canvas points at a deleted route", async () => {
		spyOn(repository, "getArtifactSubArtifacts").mockResolvedValue([
			canvasRow({ payload: { targetType: "route", targetId: "route-gone" } }),
			routeRow(),
		] as never);

		expect(applyArtifact("conv1", "proj1", "art1")).rejects.toThrow(
			serverModule.NotFoundError,
		);
	});
});
