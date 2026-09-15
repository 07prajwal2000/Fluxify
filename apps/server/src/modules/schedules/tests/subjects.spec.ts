import { describe, expect, it } from "bun:test";
import { fireTtlSeconds } from "@fluxify/common/nats";
import {
	ALL_PROJECTS,
	delayedSubject,
	fireConsumerName,
	fireSubject,
	projectFireFilter,
	projectScheduleFilter,
	scheduleSubject,
	triggerIdFromSubject,
} from "../subjects";
import { isDelayedRunBody, isScheduleFireBody } from "../types";

describe("schedule subjects", () => {
	it("keeps schedules and fires apart under one stream", () => {
		expect(scheduleSubject("p1", "t1")).toBe("fluxify.schedules.sched.p1.t1");
		expect(fireSubject("p1", "t1")).toBe("fluxify.schedules.fire.p1.t1");
	});

	it("never collides with the trigger stream's subjects", () => {
		// `fluxify.triggers.>` is a work-queue stream. A schedule captured by it
		// would be deleted by the first consumer that acked.
		expect(scheduleSubject("p1", "t1").startsWith("fluxify.triggers.")).toBe(false);
		expect(fireSubject("p1", "t1").startsWith("fluxify.triggers.")).toBe(false);
	});

	it("filters one project, or every project for the catch-all worker", () => {
		expect(projectFireFilter("p1")).toBe("fluxify.schedules.fire.p1.*");
		expect(projectFireFilter(ALL_PROJECTS)).toBe("fluxify.schedules.fire.*.*");
		expect(projectScheduleFilter(ALL_PROJECTS)).toBe("fluxify.schedules.sched.*.*");
	});

	it("keeps a block's delayed runs out of the reconciler's orphan sweep", () => {
		// The sweep purges every `sched` subject with no trigger row, and a
		// delayed run never has one — on that subject it would vanish on boot.
		expect(delayedSubject("p1", "r1")).toBe("fluxify.schedules.delay.p1.r1");
		expect(delayedSubject("p1", "r1").startsWith("fluxify.schedules.sched.")).toBe(false);
	});

	it("tells a delayed run's fire from a trigger's", () => {
		const delayed = { runId: "r1", projectId: "p1", workflowId: "w1", data: null };
		const trigger = { triggerId: "t1", projectId: "p1", workflowId: "w1" };
		expect(isDelayedRunBody(delayed)).toBe(true);
		expect(isDelayedRunBody(trigger)).toBe(false);
		expect(isScheduleFireBody(delayed)).toBe(false);
	});

	it("reads the trigger id back out", () => {
		expect(triggerIdFromSubject(fireSubject("p1", "t1"))).toBe("t1");
		expect(triggerIdFromSubject("fluxify.schedules.fire.p1")).toBeUndefined();
	});

	it("sanitizes durable names, which allow no dots or wildcards", () => {
		expect(fireConsumerName(ALL_PROJECTS)).toBe("fluxify_schedule_fires_all");
		expect(fireConsumerName("proj.1")).toBe("fluxify_schedule_fires_proj_1");
	});
});

describe("fireTtlSeconds", () => {
	it("is half an interval, capped at five minutes", () => {
		expect(fireTtlSeconds(60_000)).toBe(30);
		// A fire still pending when the next is due is a backlog forming.
		expect(fireTtlSeconds(24 * 60 * 60_000)).toBe(300);
	});

	it("never rounds down to zero, which would expire a fire instantly", () => {
		expect(fireTtlSeconds(1_000)).toBe(1);
	});

	it("leaves a one-shot without one — @at fires once or not at all", () => {
		expect(fireTtlSeconds(undefined)).toBeUndefined();
	});
});
