import { describe, expect, it } from "bun:test";
import type { RouteBundle } from "@/services/routes";
import { copyPath, importDefaults, previewCanvas } from "./routeImport";

const bundle = (route = { name: "Get users", path: "/users" }) =>
	({
		sourceProjectId: "p1",
		route,
		canvas: {
			blocks: [
				{ id: "a", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{ id: "b", type: "response", data: { httpCode: "200" }, position: { x: 9, y: 9 } },
			],
			edges: [{ id: "e1", from: "a", to: "b", fromHandle: "a-success", toHandle: "b-target" }],
		},
	}) as unknown as RouteBundle;

describe("importDefaults", () => {
	it("adds -copy to the name and path inside the project it came from", () => {
		expect(importDefaults(bundle(), "p1")).toEqual({ name: "Get users-copy", path: "/users-copy" });
	});

	it("keeps the name and path in another project", () => {
		expect(importDefaults(bundle(), "p2")).toEqual({ name: "Get users", path: "/users" });
	});

	it("keeps them when the file does not say where it came from", () => {
		const old = { ...bundle(), sourceProjectId: undefined } as RouteBundle;
		expect(importDefaults(old, "p1")).toEqual({ name: "Get users", path: "/users" });
	});
});

describe("copyPath", () => {
	it("appends to a plain path", () => expect(copyPath("/employees/active")).toBe("/employees/active-copy"));
	it("adds a segment after a param, which `:id-copy` would swallow", () =>
		expect(copyPath("/users/:id")).toBe("/users/:id/copy"));
	it("handles a trailing slash and the root", () => {
		expect(copyPath("/users/")).toBe("/users-copy");
		expect(copyPath("/")).toBe("/copy");
	});
});

describe("previewCanvas", () => {
	it("keeps the positions and names an edge's handle", () => {
		const canvas = previewCanvas(bundle());
		expect(canvas.blocks.map((b) => [b.key, b.position])).toEqual([
			["a", { x: 0, y: 0 }],
			["b", { x: 9, y: 9 }],
		]);
		expect(canvas.edges).toEqual([
			{ id: "e1", from: "a", to: "b", handle: "success", status: "same" },
		]);
	});
});
