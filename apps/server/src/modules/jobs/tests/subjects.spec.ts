import { describe, expect, it } from "bun:test";
import {
	ALL_PROJECTS,
	artifactKindsForMode,
	assertWorkerMode,
	jobConsumerName,
	jobKindsForMode,
	projectJobFilters,
} from "../subjects";

describe("worker modes", () => {
	it("gives every mode the custom-block kind", () => {
		// those jobs are enqueued by routes, so a route-only worker still runs them
		for (const mode of ["route", "workflow", "both"])
			expect(jobKindsForMode(mode)).toContain("custom-block");
	});

	it("only subscribes a workflow-capable mode to workflow jobs", () => {
		expect(jobKindsForMode("route")).not.toContain("workflow");
		expect(jobKindsForMode("workflow")).toContain("workflow");
		expect(jobKindsForMode("both")).toContain("workflow");
	});

	it("refuses an unknown mode rather than defaulting it", () => {
		expect(() => assertWorkerMode("workflows")).toThrow(/WORKER_MODE/);
	});

	it("names one subject per kind, never a wildcard", () => {
		// `.>` would make two modes on one project overlap silently
		expect(projectJobFilters("p1", ["custom-block", "workflow"])).toEqual([
			"fluxify.jobs.p1.custom-block",
			"fluxify.jobs.p1.workflow",
		]);
		expect(projectJobFilters(ALL_PROJECTS, ["workflow"])).toEqual([
			"fluxify.jobs.*.workflow",
		]);
	});

	it("puts the mode in the durable name so two modes cannot share a consumer", () => {
		expect(jobConsumerName("p1", "both")).not.toBe(
			jobConsumerName("p1", "workflow"),
		);
		expect(jobConsumerName(ALL_PROJECTS, "route")).toBe("fluxify_jobs_all_route");
	});

	it("keeps the HTTP route table out of a workflow-only worker", () => {
		expect(artifactKindsForMode("workflow")).not.toContain("route");
		expect(artifactKindsForMode("route")).not.toContain("workflow");
		expect(artifactKindsForMode("both")).toEqual([
			"route",
			"workflow",
			"custom-block",
			"project-config",
		]);
	});
});
