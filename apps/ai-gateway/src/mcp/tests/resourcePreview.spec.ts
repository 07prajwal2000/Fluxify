import { describe, expect, it } from "bun:test";
import { currentResource, PREVIEWABLE } from "../resourcePreview";

const calls: [string, unknown][] = [];
const call = async (name: string, args: unknown) => {
	calls.push([name, args]);
	return { name: "Users" };
};

describe("currentResource", () => {
	it("reads an update's target with the matching get tool", async () => {
		expect(await currentResource(call, "p1", "save_route", { routeId: "r1", name: "x" })).toEqual({ name: "Users" });
		expect(calls.at(-1)).toEqual(["get_route", { projectId: "p1", routeId: "r1" }]);
		await currentResource(call, "p1", "save_app_config", { appConfigId: 7 });
		expect(calls.at(-1)).toEqual(["get_app_config", { projectId: "p1", appConfigId: 7 }]);
	});

	it("reads what a delete removes", async () => {
		await currentResource(call, "p1", "delete_integration", { integrationId: "i1" });
		expect(calls.at(-1)).toEqual(["get_integration", { projectId: "p1", integrationId: "i1" }]);
	});

	it("a create has nothing to read", async () => {
		const before = calls.length;
		expect(await currentResource(call, "p1", "save_trigger", { name: "nightly" })).toBeNull();
		expect(calls).toHaveLength(before);
	});

	it("covers every save and delete tool of the eight resource types, and call_route", () => {
		expect(PREVIEWABLE).toHaveLength(17);
		for (const type of ["route", "workflow", "trigger", "custom_block", "middleware", "integration", "app_config", "test_suite"]) {
			expect(PREVIEWABLE).toContain(`save_${type}`);
			expect(PREVIEWABLE).toContain(`delete_${type}`);
		}
	});
});
