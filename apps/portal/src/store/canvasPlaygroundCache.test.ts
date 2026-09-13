import { beforeEach, describe, expect, it } from "bun:test";
import { useCanvasPlaygroundCacheStore } from "./canvasPlaygroundCache";

describe("useCanvasPlaygroundCacheStore", () => {
	beforeEach(() => {
		useCanvasPlaygroundCacheStore.getState().clearAll();
	});

	it("returns undefined for uncached route", () => {
		const state = useCanvasPlaygroundCacheStore.getState().getPlaygroundState("route-1");
		expect(state).toBeUndefined();
	});

	it("stores and retrieves state by routeId", () => {
		const sampleState = {
			pathRows: [{ id: "1", key: "id", value: "100" }],
			queryRows: [{ id: "2", key: "search", value: "fluxify" }],
			headerRows: [{ id: "3", key: "Content-Type", value: "application/json" }],
			contentType: "application/json",
			body: '{"test":true}',
			response: {
				status: 200,
				statusText: "OK",
				body: '{"success":true}',
			},
		};

		useCanvasPlaygroundCacheStore.getState().setPlaygroundState("route-1", sampleState);

		const retrieved = useCanvasPlaygroundCacheStore.getState().getPlaygroundState("route-1");
		expect(retrieved).toEqual(sampleState);

		// Different route should not have it
		expect(useCanvasPlaygroundCacheStore.getState().getPlaygroundState("route-2")).toBeUndefined();
	});

	it("clears state for specific routeId", () => {
		useCanvasPlaygroundCacheStore.getState().setPlaygroundState("route-1", { body: "1" });
		useCanvasPlaygroundCacheStore.getState().setPlaygroundState("route-2", { body: "2" });

		useCanvasPlaygroundCacheStore.getState().clearPlaygroundState("route-1");

		expect(useCanvasPlaygroundCacheStore.getState().getPlaygroundState("route-1")).toBeUndefined();
		expect(useCanvasPlaygroundCacheStore.getState().getPlaygroundState("route-2")?.body).toBe("2");
	});
});
