import { describe, expect, it } from "bun:test";
import type { RouteBundle } from "@/services/routes";
import { conflictNotice, copyPath, importDefaults, previewCanvas } from "./routeImport";

const bundle = (route = { name: "Get users", path: "/users" }) =>
	({
		route,
		canvas: {
			blocks: [
				{ id: "a", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
				{ id: "b", type: "response", data: { httpCode: "200" }, position: { x: 9, y: 9 } },
			],
			edges: [{ id: "e1", from: "a", to: "b", fromHandle: "a-success", toHandle: "b-target" }],
		},
	}) as unknown as RouteBundle;

const route = { name: "Get users", path: "/users", method: "GET" } as RouteBundle["route"];
const free = { nameTaken: false, pathTaken: false };

describe("importDefaults", () => {
	it("keeps the name and path when nothing is taken", () => {
		expect(importDefaults(route, free)).toEqual({ name: "Get users", path: "/users" });
	});

	it("adds -copy to what is taken, and only to that", () => {
		expect(importDefaults(route, { nameTaken: true, pathTaken: true })).toEqual({
			name: "Get users-copy",
			path: "/users-copy",
		});
		expect(importDefaults(route, { nameTaken: false, pathTaken: true })).toEqual({
			name: "Get users",
			path: "/users-copy",
		});
		expect(importDefaults(route, { nameTaken: true, pathTaken: false })).toEqual({
			name: "Get users-copy",
			path: "/users",
		});
	});
});

describe("conflictNotice", () => {
	it("says nothing when nothing is taken", () => {
		expect(conflictNotice(route, free)).toBeUndefined();
	});

	it("names what already exists and offers a copy or a rename", () => {
		const both = conflictNotice(route, { nameTaken: true, pathTaken: true });
		expect(both).toContain('a route named "Get users" and GET /users already exist');
		expect(both).toContain("imported as a copy");
		expect(both).toContain("rename it");
		expect(conflictNotice(route, { nameTaken: false, pathTaken: true })).toContain(
			"GET /users already exists in this project",
		);
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
