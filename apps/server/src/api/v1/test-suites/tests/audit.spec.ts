import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { transport } from "../../../../modules/audit/audit";
import { runWithAuditContext } from "../../../../modules/audit/context";
import { gateOverride } from "../../../../modules/audit/gate";
import type { AuditEvent } from "../../../../modules/audit/types";

// the project's name and slug are read once the gate passes
const chain: any = {
	select: () => chain,
	from: () => chain,
	leftJoin: () => chain,
	where: async () => [{ name: "Shop", slug: "shop", enabled: "true" }],
};
mock.module("../../../../db", () => ({ db: chain }));
mock.module("../../../../modules/testRunner/runner", () => ({
	startTestRun: async () => ({ runId: "run-1", done: Promise.resolve() }),
	TestRunError: class extends Error {},
}));

const { default: startRun } = await import("../start-run/service");
const target = { type: "route", id: "r1" } as const;
const ACTOR = { actorId: "u1", actorEmail: "ada@example.com" };

let published: AuditEvent[];

beforeEach(() => {
	gateOverride.licensed = true;
	gateOverride.projectEnabled = true;
	published = [];
	spyOn(transport, "publish").mockImplementation(async (event) => {
		published.push(event);
	});
});

afterEach(() => {
	gateOverride.licensed = undefined;
	gateOverride.projectEnabled = undefined;
	spyOn(transport, "publish").mockRestore();
});

const run = (input: { suiteIds?: string[]; env?: "development" | "production" }) =>
	runWithAuditContext({ actor: ACTOR, source: "portal" }, () =>
		startRun({ projectId: "p1", target, ...input }),
	);

describe("starting a test run is recorded", () => {
	it("says nothing extra for one suite in development", async () => {
		await run({ suiteIds: ["s1"] });
		expect(published).toHaveLength(1);
		expect(published[0]).toMatchObject({
			resourceType: "test_run",
			resourceId: "run-1",
			action: "run",
			projectId: "p1",
			changedFields: ["suiteIds"],
		});
		expect(published[0]!.message).toBeUndefined();
	});

	it("says it ran in production canvas", async () => {
		await run({ suiteIds: ["s1"], env: "production" });
		expect(published[0]!.message).toBe("Ran in production canvas");
	});

	it("says when every suite ran, in production or not", async () => {
		await run({});
		await run({ env: "production" });
		expect(published.map((e) => e.message)).toEqual([
			"Ran all suites",
			"Ran all suites in production canvas",
		]);
	});

	it("records nothing when the project has audit logs off", async () => {
		gateOverride.projectEnabled = false;
		await run({ env: "production" });
		expect(published).toHaveLength(0);
	});
});
