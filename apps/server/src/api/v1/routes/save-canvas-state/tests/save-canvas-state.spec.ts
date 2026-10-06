import { describe, expect, it, mock } from "bun:test";
import type { AuthACL } from "../../../../../db/schema";
import handleRequest from "../service";

mock.module("../../../../../modules/canvas/service", () => ({
	saveCanvas: mock(),
}));

const { saveCanvas } = await import("../../../../../modules/canvas/service");

describe("save route canvas", () => {
	it("passes only the projects the caller can edit", async () => {
		const acl: AuthACL[] = [
			{ projectId: "viewed", role: "viewer" },
			{ projectId: "built", role: "creator" },
		];
		await handleRequest("route-1", {} as any, acl);

		expect((saveCanvas as any).mock.calls[0][2]).toEqual(["built"]);
	});
});
