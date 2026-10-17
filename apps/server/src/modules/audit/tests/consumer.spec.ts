import { describe, expect, it } from "bun:test";
import { writeAuditBatch } from "../consumer";
import { buildEvent } from "../event";
import type { AuditEvent, AuditSink } from "../types";

const actor = { actorId: "u1", actorEmail: "a@b.c", source: "portal" as const };
const event = (): AuditEvent =>
	buildEvent(
		{ resourceType: "route", resourceId: "r1", action: "update", changedFields: ["name"] },
		null,
		actor,
		null,
	);

function recordingSink() {
	const batches: AuditEvent[][] = [];
	const sink: AuditSink = {
		async insert(batch) {
			batches.push(batch);
		},
	};
	return { sink, batches };
}

describe("writeAuditBatch", () => {
	it("hands a whole batch to the sink in one insert", async () => {
		const { sink, batches } = recordingSink();
		const events = Array.from({ length: 5 }, event);
		expect(await writeAuditBatch(events, sink)).toBe(5);
		expect(batches).toHaveLength(1);
		expect(batches[0]!.map((e) => e.id)).toEqual(events.map((e) => e.id));
	});

	it("drops an event that cannot be read and keeps the rest", async () => {
		const { sink, batches } = recordingSink();
		const good = event();
		expect(await writeAuditBatch([{ nope: true }, good, null], sink)).toBe(1);
		expect(batches[0]).toEqual([good]);
	});

	it("does not call the sink for a batch with nothing valid", async () => {
		const { sink, batches } = recordingSink();
		expect(await writeAuditBatch([{ nope: true }], sink)).toBe(0);
		expect(batches).toHaveLength(0);
	});

	it("lets a sink failure through, so the broker redelivers the batch", async () => {
		const sink: AuditSink = {
			insert: async () => {
				throw new Error("database is down");
			},
		};
		await expect(writeAuditBatch([event()], sink)).rejects.toThrow("database is down");
	});
});
