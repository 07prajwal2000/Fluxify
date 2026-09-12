import { describe, expect, it } from "bun:test";
import {
	ALL_PROJECTS,
	artifactKindsForMode,
	assertWorkerMode,
	jobConsumerName,
	jobFilter,
	jobKindsForMode,
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

	it("filters on one project and one kind, never a wildcard", () => {
		expect(jobFilter("p1", "custom-block")).toBe("fluxify.jobs.p1.custom-block");
		expect(jobFilter("p1", "workflow")).toBe("fluxify.jobs.p1.workflow");
	});

	it("names a durable by project and kind, so two modes can share it", () => {
		// a catch-all `both` worker and a project's own `workflow` worker both
		// take its workflow jobs: same consumer, work split between them
		expect(jobConsumerName("p1", "workflow")).toBe("fluxify_jobs_p1_workflow");
		expect(jobConsumerName("p1", "custom-block")).toBe(
			"fluxify_jobs_p1_custom-block",
		);
	});

	it("refuses a wildcard consumer instead of locking every worker out", () => {
		// `fluxify.jobs.*.workflow` overlaps every per-project filter, and a
		// work-queue stream refuses the second consumer of an overlapping pair
		expect(() => jobFilter(ALL_PROJECTS, "workflow")).toThrow(/one project/);
		expect(() => jobConsumerName(ALL_PROJECTS, "workflow")).toThrow(/one project/);
	});

	it("keeps the HTTP route table out of a workflow-only worker", () => {
		expect(artifactKindsForMode("workflow")).not.toContain("route");
		expect(artifactKindsForMode("route")).not.toContain("workflow");
		expect(artifactKindsForMode("both")).toEqual([
			"route",
			"workflow",
			"custom-block",
			"project-config",
			"trigger",
		]);
		// a route-only worker runs no workflows, so a trigger it could not act on
		// is just memory
		expect(artifactKindsForMode("route")).not.toContain("trigger");
	});
});
