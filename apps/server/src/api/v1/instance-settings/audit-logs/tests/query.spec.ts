import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { BadRequestError } from "../../../../../errors/badRequestError";
import { type AuditFilters, auditWhere, decodeCursor, encodeCursor } from "../list/query";

const render = (f: AuditFilters, after?: Parameters<typeof auditWhere>[1]) => {
	const where = auditWhere(f, after);
	return where ? new PgDialect().sqlToQuery(where) : null;
};

const ID = "019a0000-0000-7000-8000-000000000001";

describe("audit log cursor", () => {
	it("round-trips the time and id", () => {
		const ts = new Date("2026-10-17T10:00:00.123Z");
		expect(decodeCursor(encodeCursor(ts, ID))).toEqual({ ts, id: ID });
	});

	it("is URL safe", () => {
		expect(encodeCursor(new Date(), ID)).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	const bad = {
		"not base64 json": "!!!",
		"empty": "",
		"wrong shape": Buffer.from(JSON.stringify({ ts: 1 })).toString("base64url"),
		"one element": Buffer.from(JSON.stringify(["2026-10-17T10:00:00.000Z"])).toString("base64url"),
		"bad time": Buffer.from(JSON.stringify(["yesterday", ID])).toString("base64url"),
		"bad id": Buffer.from(JSON.stringify(["2026-10-17T10:00:00.000Z", "nope"])).toString("base64url"),
	};
	for (const [name, cursor] of Object.entries(bad)) {
		it(`rejects a cursor that is ${name}`, () => {
			expect(() => decodeCursor(cursor)).toThrow(BadRequestError);
		});
	}
});

describe("audit log filters", () => {
	it("adds no condition when nothing is set", () => {
		expect(render({})).toBeNull();
	});

	it("binds every value as a parameter, never into the text", () => {
		const q = render({
			projectId: "p1",
			actorId: "u1",
			resourceType: "route",
			action: "update",
			source: "mcp",
		})!;
		expect(q.params).toEqual(["p1", "u1", "route", "update", "mcp"]);
		for (const column of ["project_id", "actor_id", "resource_type", "action", "source"]) {
			expect(q.sql).toContain(`"${column}" = $`);
		}
		expect(q.sql).not.toContain("p1");
	});

	it("takes the time range as from inclusive, to exclusive", () => {
		const from = new Date("2026-10-01T00:00:00Z");
		const to = new Date("2026-10-02T00:00:00Z");
		const q = render({ from, to })!;
		expect(q.sql).toContain('"ts" >= $1');
		expect(q.sql).toContain('"ts" < $2');
		expect(q.params).toEqual([from.toISOString(), to.toISOString()]);
	});

	it("matches email and resource id as text, any case, without wildcards", () => {
		const q = render({ actorEmail: "50%_off\\", resourceId: "ab" })!;
		expect(q.sql).toContain('"actor_email" ilike $1');
		expect(q.sql).toContain('"resource_id" ilike $2');
		expect(q.params).toEqual(["%50\\%\\_off\\\\%", "%ab%"]);
	});

	it("continues after the cursor with a (ts, id) comparison, newest first", () => {
		const ts = new Date("2026-10-17T10:00:00.000Z");
		const q = render({ projectId: "p1" }, { ts, id: ID })!;
		expect(q.sql).toContain('("audit_events"."ts", "audit_events"."id") < ($2::timestamptz, $3::uuid)');
		expect(q.params).toEqual(["p1", ts.toISOString(), ID]);
	});
});
