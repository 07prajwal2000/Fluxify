import { describe, expect, it } from "bun:test";
import {
	ALL_PROJECTS,
	internalConsumerName,
	internalSubject,
	triggerConsumerName,
	triggerSubject,
} from "../subjects";

/**
 * Subjects and durable names. The property that matters is that no two
 * consumers ever filter overlapping subjects — a work-queue stream refuses the
 * second one, and the failure shows up at boot on whichever worker happened to
 * start later.
 */

describe("trigger subjects", () => {
	it("keeps the internal path and a trigger row on separate subjects", () => {
		expect(internalSubject("p1")).toBe("fluxify.triggers.p1.internal");
		expect(triggerSubject("p1", "t1")).toBe("fluxify.triggers.p1.t1");
		expect(internalSubject("p1")).not.toBe(triggerSubject("p1", "t1"));
	});

	it("scopes by project, so one tenant never filters another's events", () => {
		expect(triggerSubject("p1", "t1")).not.toBe(triggerSubject("p2", "t1"));
	});

	it("gives every trigger its own durable, which is what keeps filters disjoint", () => {
		expect(triggerConsumerName("t1")).not.toBe(triggerConsumerName("t2"));
	});

	it("names replicas of one deployment the same, so they compete for events", () => {
		expect(triggerConsumerName("t1")).toBe(triggerConsumerName("t1"));
	});

	it("produces consumer names without dots or wildcards", () => {
		// NATS rejects both, and a project id is not guaranteed to avoid them
		expect(internalConsumerName("proj.with.dots")).toBe(
			"fluxify_triggers_proj_with_dots_internal",
		);
		expect(triggerConsumerName("a*b.c")).toBe("fluxify_trigger_a_b_c");
	});

	it("refuses a catch-all internal consumer, which would overlap every project's", () => {
		// this stream is work-queue: `fluxify.triggers.*.internal` and
		// `fluxify.triggers.p1.internal` cannot both exist, so a catch-all worker
		// serves each project it discovers instead
		expect(() => internalConsumerName(ALL_PROJECTS)).toThrow(/one project/);
	});
});
