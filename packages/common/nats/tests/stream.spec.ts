import { describe, expect, it } from "bun:test";
import { RetentionPolicy } from "@nats-io/jetstream";
import {
	newConsumerConfig,
	newStreamConfig,
	updatableConsumerConfig,
	updatableStreamConfig,
} from "../stream";

const MS_TO_NS = 1_000_000;

describe("updatableStreamConfig", () => {
	it("converts millisecond options to the nanoseconds NATS expects", () => {
		const config = updatableStreamConfig({
			name: "S",
			subjects: ["a.>"],
			maxAgeMs: 24 * 60 * 60 * 1000,
			duplicateWindowMs: 2 * 60 * 1000,
		});
		expect(config.max_age).toBe(24 * 60 * 60 * 1000 * MS_TO_NS);
		expect(config.duplicate_window).toBe(2 * 60 * 1000 * MS_TO_NS);
	});

	it("omits what NATS will not change on a live stream", () => {
		// retention and storage are fixed at creation; sending them on an update
		// is how you get a rejection at boot on an otherwise valid config
		const config = updatableStreamConfig({
			name: "S",
			subjects: ["a.>"],
			retention: "workqueue",
			storage: "memory",
		});
		expect(config).not.toHaveProperty("retention");
		expect(config).not.toHaveProperty("storage");
		expect(config.subjects).toEqual(["a.>"]);
	});

	it("leaves unset limits alone rather than writing defaults over them", () => {
		const config = updatableStreamConfig({ name: "S", subjects: ["a.>"] });
		expect(Object.keys(config)).toEqual(["subjects"]);
	});
});

describe("newStreamConfig", () => {
	it("defaults to limits retention", () => {
		expect(newStreamConfig({ name: "S", subjects: ["a"] }).retention).toBe(
			RetentionPolicy.Limits,
		);
	});

	it("carries retention through on creation", () => {
		const config = newStreamConfig({
			name: "S",
			subjects: ["a"],
			retention: "workqueue",
		});
		expect(config.retention).toBe(RetentionPolicy.Workqueue);
		expect(config.name).toBe("S");
	});
});

describe("newConsumerConfig", () => {
	it("uses the singular filter for one subject, so 2.9 servers still work", () => {
		const config = newConsumerConfig({ durable: "d", filterSubjects: ["a.b"] });
		expect(config.filter_subject).toBe("a.b");
		expect(config).not.toHaveProperty("filter_subjects");
	});

	it("uses the plural filter only when there is more than one", () => {
		const config = newConsumerConfig({
			durable: "d",
			filterSubjects: ["a.b", "a.c"],
		});
		expect(config.filter_subjects).toEqual(["a.b", "a.c"]);
		expect(config).not.toHaveProperty("filter_subject");
	});

	it("sets no filter at all when none is asked for", () => {
		const config = newConsumerConfig({ durable: "d" });
		expect(config).not.toHaveProperty("filter_subject");
		expect(config).not.toHaveProperty("filter_subjects");
	});

	it("defaults to a single delivery attempt", () => {
		expect(updatableConsumerConfig({ durable: "d" }).max_deliver).toBe(1);
		expect(updatableConsumerConfig({ durable: "d" }).ack_wait).toBe(60_000 * MS_TO_NS);
	});
});
