import { describe, expect, it } from "bun:test";
import { JOBS_STREAM_SPEC, jobFilter } from "../../modules/jobs/subjects";
import { fireSubject, SCHEDULES_STREAM } from "../../modules/schedules/subjects";
import { testRunSubject } from "../../modules/testRunner/types";
import { internalSubject, TRIGGERS_STREAM_SPEC } from "../../modules/triggers/subjects";
import { natsName, natsStreamSpec } from "../nats";
import { ARTIFACT_BUCKET } from "../natsKv";

describe("natsName (#732)", () => {
	it("leaves every production name exactly as it was", () => {
		const names = [
			ARTIFACT_BUCKET,
			JOBS_STREAM_SPEC.name,
			...JOBS_STREAM_SPEC.subjects,
			jobFilter("p1", "workflow"),
			TRIGGERS_STREAM_SPEC.name,
			internalSubject("p1"),
			SCHEDULES_STREAM,
			fireSubject("p1", "t1"),
			testRunSubject("p1"),
		];
		expect(names.map((name) => natsName(name, "production"))).toEqual([
			"fluxify_artifacts",
			"FLUXIFY_JOBS",
			"fluxify.jobs.>",
			"fluxify.jobs.p1.workflow",
			"FLUXIFY_TRIGGERS",
			"fluxify.triggers.p1.internal",
			"FLUXIFY_SCHEDULES",
			"fluxify.schedules.fire.p1.t1",
			"fluxify.tests.run.p1",
		]);
		expect(natsStreamSpec(JOBS_STREAM_SPEC, "production")).toBe(JOBS_STREAM_SPEC);
	});

	it("gives development its own bucket, streams and subjects", () => {
		expect(natsName(ARTIFACT_BUCKET, "development")).toBe("fluxify_dev_artifacts");
		expect(natsName("FLUXIFY_JOBS", "development")).toBe("FLUXIFY_DEV_JOBS");
		expect(natsName(jobFilter("p1", "workflow"), "development")).toBe(
			"fluxify.dev.jobs.p1.workflow",
		);
		expect(natsName(testRunSubject("p1"), "development")).toBe("fluxify.dev.tests.run.p1");
		expect(natsStreamSpec(TRIGGERS_STREAM_SPEC, "development")).toMatchObject({
			name: "FLUXIFY_DEV_TRIGGERS",
			subjects: ["fluxify.dev.triggers.>"],
			retention: "workqueue",
		});
	});

	it("refuses a name it cannot place in development", () => {
		expect(() => natsName("orders.created", "development")).toThrow(/not a Fluxify NATS name/);
	});
});
