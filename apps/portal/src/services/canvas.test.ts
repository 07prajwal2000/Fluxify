import { describe, expect, it, mock } from "bun:test";

const calls: { method: string; url: string; body?: unknown }[] = [];
mock.module("@/lib/http", () => ({
	httpClient: {
		get: async (url: string) => {
			calls.push({ method: "get", url });
			return { data: { blocks: [], edges: [] } };
		},
		put: async (url: string, body: unknown) => {
			calls.push({ method: "put", url, body });
			return { data: null };
		},
		post: async () => ({ data: null }),
		delete: async () => ({ data: null }),
	},
}));

const { routesService } = await import("./routes");
const { customBlocksService } = await import("./customBlocks");

const payload = {
	actionsToPerform: { blocks: [], edges: [] },
	changes: { blocks: [], edges: [] },
};

// The point of the shared factory: a custom block's canvas is the same two
// endpoints as a route's, under a different base.
describe("canvas endpoints", () => {
	it("hits the same paths for both parents", async () => {
		calls.length = 0;
		await routesService.getCanvasItems("r-1");
		await routesService.saveCanvasItems("r-1", payload);
		await customBlocksService.getCanvasItems("cb-1");
		await customBlocksService.saveCanvasItems("cb-1", payload);

		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			"get /v1/routes/r-1/canvas-items",
			"put /v1/routes/r-1/save-canvas",
			"get /v1/custom-blocks/cb-1/canvas-items",
			"put /v1/custom-blocks/cb-1/save-canvas",
		]);
		expect(calls[3].body).toEqual(payload);
	});
});
