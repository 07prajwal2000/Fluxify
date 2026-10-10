import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { httpClient } from "@/lib/http";
import type { CanvasSavePayload } from "./canvas";
import { sandboxCanvas, sandboxesService } from "./sandboxes";

afterEach(() => {
	// spies are per test: bun restores them with mock.restore, which the next import would not do
	for (const method of ["get", "put", "post", "patch", "delete"] as const) {
		(httpClient[method] as { mockRestore?: () => void }).mockRestore?.();
	}
});

const payload: CanvasSavePayload = {
	actionsToPerform: { blocks: [{ id: "b1", action: "upsert" }], edges: [] },
	changes: {
		blocks: [{ id: "b1", type: "jsRunner", data: {}, position: { x: 0, y: 0 } }],
		edges: [],
	},
};

describe("the sandbox canvas adapter", () => {
	test("saves through the sandbox's own endpoint", async () => {
		const put = spyOn(httpClient, "put").mockResolvedValue({ data: { ok: true } });
		await sandboxCanvas("p1").saveCanvasItems("s1", payload);
		expect(put).toHaveBeenCalledWith("/v1/projects/p1/sandboxes/s1/save-canvas", payload);
	});

	test("loads the canvas and its version from the sandbox", async () => {
		const get = spyOn(httpClient, "get")
			.mockResolvedValueOnce({ data: { canvasVersion: 3, blocks: [], edges: [] } })
			.mockResolvedValueOnce({ data: { canvasVersion: 3 } });
		const canvas = sandboxCanvas("p1");
		await canvas.getCanvasItems("s1");
		expect(await canvas.getCanvasVersion("s1")).toBe(3);
		expect(get.mock.calls.map((call) => call[0])).toEqual([
			"/v1/projects/p1/sandboxes/s1/canvas-items",
			"/v1/projects/p1/sandboxes/s1/canvas-version",
		]);
	});
});

describe("the sandbox endpoints", () => {
	test("create, rename, delete and run all stay under the project", async () => {
		const post = spyOn(httpClient, "post").mockResolvedValue({ data: { id: "s1" } });
		const patch = spyOn(httpClient, "patch").mockResolvedValue({ data: {} });
		const del = spyOn(httpClient, "delete").mockResolvedValue({ data: {} });

		await sandboxesService.create("p1", { name: "Scratch" });
		await sandboxesService.update("p1", "s1", { name: "Other" });
		await sandboxesService.run("p1", "s1", { a: 1 });
		await sandboxesService.delete("p1", "s1");

		expect(post.mock.calls[0]).toEqual(["/v1/projects/p1/sandboxes", { name: "Scratch" }]);
		expect(patch.mock.calls[0]).toEqual(["/v1/projects/p1/sandboxes/s1", { name: "Other" }]);
		expect(post.mock.calls[1]).toEqual(["/v1/projects/p1/sandboxes/s1/run", { payload: { a: 1 } }]);
		expect(del.mock.calls[0]).toEqual(["/v1/projects/p1/sandboxes/s1"]);
	});
});
