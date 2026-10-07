import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("../../../../../db", () => ({ db: {} }));

import { ForbiddenError } from "../../../../../errors/forbidError";
import { NotFoundError } from "../../../../../errors/notFoundError";
import * as canvasRepo from "../../../../../modules/canvas/repository";
import * as customBlockRepo from "../../../custom-blocks/get-canvas-items/repository";
import getCustomBlockVersion from "../../../custom-blocks/get-canvas-version/service";
import getRouteVersion from "../service";

let parentExists: ReturnType<typeof spyOn<typeof canvasRepo, "parentExists">>;
const viewer = [{ projectId: "p1", role: "viewer" as const }] as any;
const user = { isSystemAdmin: false } as any;

beforeEach(() => {
	// other files leave spies behind (hasProjectAccess, for one)
	mock.restore();
	parentExists = spyOn(canvasRepo, "parentExists").mockResolvedValue(true);
	spyOn(canvasRepo, "getCanvasVersion").mockResolvedValue(7);
	spyOn(customBlockRepo, "getCustomBlockById").mockResolvedValue({ projectId: "p1" });
});

describe("get canvas version (#597)", () => {
	it("returns a route's version, scoped to the caller's projects", async () => {
		expect(await getRouteVersion("r-1", viewer)).toEqual({ canvasVersion: 7 });
		expect(parentExists).toHaveBeenCalledWith({ type: "route", id: "r-1" }, ["p1"]);
	});

	it("404s a route outside the caller's projects", async () => {
		parentExists.mockResolvedValue(false);
		await expect(getRouteVersion("r-1", viewer)).rejects.toBeInstanceOf(NotFoundError);
	});

	it("lets a viewer read a custom block's version", async () => {
		expect(await getCustomBlockVersion("cb-1", user, viewer)).toEqual({ canvasVersion: 7 });
	});

	it("forbids a custom block in another project", async () => {
		await expect(getCustomBlockVersion("cb-1", user, [])).rejects.toBeInstanceOf(ForbiddenError);
	});
});
