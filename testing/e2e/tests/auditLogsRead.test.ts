// Reading the audit log (#834, Enterprise) end to end: a real admin server,
// Postgres and NATS, on the stack from #833 (`src/audit.ts`). Most rows are
// inserted straight into the table, so a test controls time, ids and projects;
// a few go through the real write path.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	type AuditStack,
	admin,
	auditDb,
	ORIGIN,
	startAuditStack,
	stopAuditStack,
	type Way,
} from "../src/audit";

// the password the harness gives every user it makes (authHarness.ts)
const PASSWORD = "Passw0rd!test";
const LIST = "/v1/instance-settings/audit-logs";

let stack: AuditStack;
let db: ReturnType<typeof auditDb>;
let portal: Way;
const uniq = () => Bun.randomUUIDv7().replaceAll("-", "").slice(-10);

beforeAll(async () => {
	stack = await startAuditStack();
	db = auditDb(stack);
	portal = { cookie: stack.tokens.cookie };
}, 300_000);

afterAll(async () => {
	await db?.close().catch(() => {});
	await stopAuditStack();
});

type Seed = {
	id?: string;
	ts: Date;
	actorId?: string;
	actorEmail?: string;
	source?: string;
	projectId?: string | null;
	projectName?: string | null;
	resourceType?: string;
	resourceId?: string;
	action?: string;
	changedFields?: string[];
	status?: string;
	message?: string | null;
};

/** One row straight into the table; returns its id. */
async function seed(s: Seed) {
	const id = s.id ?? Bun.randomUUIDv7();
	await db.sql`
		INSERT INTO audit_events (id, ts, actor_id, actor_email, source, project_id, project_name,
			project_slug, resource_type, resource_id, action, changed_fields, status, message)
		VALUES (${id}, ${s.ts}, ${s.actorId ?? "u-seed"}, ${s.actorEmail ?? "seed@test.local"},
			${s.source ?? "portal"}, ${s.projectId ?? null}, ${s.projectName ?? null},
			${s.projectName ?? null}, ${s.resourceType ?? "route"}, ${s.resourceId ?? "r1"},
			${s.action ?? "update"}, ${JSON.stringify(s.changedFields ?? ["name"])}::text::jsonb,
			${s.status ?? "success"}, ${s.message ?? null})`;
	return id;
}

const query = (params: Record<string, string | number | undefined>) =>
	new URLSearchParams(
		Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
	).toString();

const list = (params: Record<string, string | number | undefined>, way: Way = portal) =>
	admin(stack, way, "GET", `${LIST}?${query(params)}`);

/** every page of a listing, following nextCursor */
async function allPages(params: Record<string, string | number | undefined>) {
	const rows: { id: string; ts: string }[] = [];
	let cursor: string | undefined;
	for (let pages = 0; pages < 50; pages++) {
		const res = await list({ ...params, cursor });
		expect(res.status).toBe(200);
		rows.push(...res.body.data);
		if (!res.body.nextCursor) return { rows, pages: pages + 1 };
		cursor = res.body.nextCursor;
	}
	throw new Error("paging never ended");
}

/** A user made through the admin API who signs in with a cookie. */
async function userWay(isSystemAdmin = false) {
	const email = `${uniq()}@test.local`;
	const made = await admin(stack, portal, "POST", "/auth/create-user", {
		email,
		password: PASSWORD,
		fullname: "Reader",
		isSystemAdmin,
	});
	expect(made.status).toBeLessThan(300);
	const res = await fetch(`${stack.url}/_/admin/api/auth/sign-in/email`, {
		method: "POST",
		headers: { origin: ORIGIN, "content-type": "application/json" },
		body: JSON.stringify({ email, password: PASSWORD }),
	});
	expect(res.status).toBe(200);
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	return { id: made.body.id as string, way: { cookie } as Way };
}

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);

describe("audit log list", () => {
	it("shows an admin the rows, newest first, in the documented shape", async () => {
		const rt = `shape_${uniq()}`;
		const old = await seed({ ts: at(0), resourceType: rt, projectId: stack.projectId, projectName: "Then" });
		const recent = await seed({
			ts: at(60),
			resourceType: rt,
			projectId: stack.projectId,
			projectName: "Then",
			source: "mcp",
			actorId: stack.admin.id,
			actorEmail: stack.admin.email,
			changedFields: ["name", "path"],
			message: "renamed",
		});
		const res = await list({ resourceType: rt });
		expect(res.status).toBe(200);
		expect(res.body.nextCursor).toBeNull();
		expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([recent, old]);
		expect(res.body.data[0]).toEqual({
			id: recent,
			ts: at(60).toISOString(),
			actorId: stack.admin.id,
			actorEmail: stack.admin.email,
			source: "mcp",
			projectId: stack.projectId,
			projectName: "Then",
			projectSlug: "Then",
			projectDeleted: false,
			resourceType: rt,
			resourceId: "r1",
			action: "update",
			changedFields: ["name", "path"],
			status: "success",
			message: "renamed",
		});
	});

	it("is for system admins only: a plain user, a project admin and an anonymous caller are refused", async () => {
		const plain = await userWay();
		const projectAdmin = await userWay();
		const added = await admin(
			stack,
			portal,
			"POST",
			`/v1/projects/${stack.projectId}/settings/members/add`,
			{ userId: projectAdmin.id, role: "project_admin" },
		);
		expect(added.status).toBe(201);

		for (const way of [plain.way, projectAdmin.way]) {
			expect((await list({}, way)).status).toBe(403);
			expect((await admin(stack, way, "GET", `${LIST}/filters`)).status).toBe(403);
		}
		const anonymous = await fetch(`${stack.url}/_/admin/api${LIST}`, { headers: { origin: ORIGIN } });
		expect(anonymous.status).toBe(403); // same refusal as every other system-admin route

		const second = await userWay(true);
		expect((await list({}, second.way)).status).toBe(200);
	});

	it("rejects an instance without the audit logs licence, and works again once it is back", async () => {
		expect((await admin(stack, portal, "PUT", "/v1/instance-settings/license", { edition: "community" })).status).toBe(200);
		try {
			const refused = await list({});
			expect(refused.status).toBe(403);
			expect(refused.body.message).toBe("Audit logs need an enterprise license");
			expect((await admin(stack, portal, "GET", `${LIST}/filters`)).status).toBe(403);
		} finally {
			const restored = await admin(stack, portal, "PUT", "/v1/instance-settings/license", {
				edition: "non_commercial",
				confirmNonCommercial: true,
			});
			expect(restored.status).toBe(200);
		}
		expect((await list({})).status).toBe(200);
	});

	it("narrows by each filter", async () => {
		const p = `filt_${uniq()}`;
		const rid = `res_${uniq()}`;
		const a = await seed({ ts: at(0), projectId: p, actorId: "u-a", actorEmail: "Alice@Test.local", source: "portal", resourceType: "route", resourceId: `${rid}-1`, action: "create" });
		const b = await seed({ ts: at(100), projectId: p, actorId: "u-b", actorEmail: "bob@test.local", source: "pat", resourceType: "workflow", resourceId: `${rid}-2`, action: "update" });
		const c = await seed({ ts: at(200), projectId: p, actorId: "u-a", actorEmail: "Alice@Test.local", source: "agent", resourceType: "route", resourceId: "other", action: "delete" });
		const d = await seed({ ts: at(300), projectId: p, actorId: "u-c", actorEmail: "carol@test.local", source: "mcp", resourceType: "trigger", resourceId: "t1", action: "update" });
		const other = await seed({ ts: at(150), projectId: `not_${p}` });
		const ids = async (params: Record<string, string>) => {
			const res = await list({ projectId: p, ...params });
			expect(res.status).toBe(200);
			return res.body.data.map((r: { id: string }) => r.id);
		};

		expect(await ids({})).toEqual([d, c, b, a]);
		expect(await ids({ actorId: "u-a" })).toEqual([c, a]);
		expect(await ids({ actorEmail: "ALICE" })).toEqual([c, a]);
		expect(await ids({ resourceType: "route" })).toEqual([c, a]);
		expect(await ids({ action: "update" })).toEqual([d, b]);
		expect(await ids({ source: "pat" })).toEqual([b]);
		expect(await ids({ resourceId: rid.toUpperCase() })).toEqual([b, a]);
		expect(await ids({ resourceId: "%" })).toEqual([]); // a wildcard is just a character
		expect(await ids({ from: at(100).toISOString() })).toEqual([d, c, b]);
		expect(await ids({ to: at(200).toISOString() })).toEqual([b, a]);
		expect(await ids({ from: at(100).toISOString(), to: at(300).toISOString(), source: "agent" })).toEqual([c]);
		expect(await ids({ actorId: "u-a", action: "update" })).toEqual([]);
		expect(await list({ projectId: `not_${p}` }).then((r) => r.body.data.map((x: { id: string }) => x.id))).toEqual([other]);
	});

	it("rejects a filter it does not know", async () => {
		expect((await list({ source: "carrier-pigeon" })).status).toBe(400);
		expect((await list({ from: "yesterday-ish" })).status).toBe(400);
		expect((await list({ limit: 201 })).status).toBe(400);
		expect((await list({ limit: 0 })).status).toBe(400);
	});

	it("pages with no gaps or repeats, even when many events share one timestamp", async () => {
		const p = `page_${uniq()}`;
		const made: string[] = [];
		for (let i = 0; i < 7; i++) made.push(await seed({ ts: at(500), projectId: p, resourceId: `same-${i}` }));
		for (let i = 0; i < 3; i++) made.push(await seed({ ts: at(400 + i), projectId: p, resourceId: `own-${i}` }));

		const { rows, pages } = await allPages({ projectId: p, limit: 3 });
		expect(pages).toBe(4); // 3 + 3 + 3 + 1: the page boundaries fall inside the tied events
		const got = rows.map((r) => r.id);
		expect(new Set(got).size).toBe(10);
		expect([...got].sort()).toEqual([...made].sort());
		// newest first; ties broken by id, descending
		const expected = [...rows].sort((x, y) => (x.ts === y.ts ? (x.id < y.id ? 1 : -1) : x.ts < y.ts ? 1 : -1));
		expect(got).toEqual(expected.map((r) => r.id));

		// a page that ends exactly on the last row has no cursor
		const exact = await list({ projectId: p, limit: 10 });
		expect(exact.body.data).toHaveLength(10);
		expect(exact.body.nextCursor).toBeNull();
	});

	it("defaults to 50 a page and rejects a cursor it did not issue", async () => {
		const p = `deflt_${uniq()}`;
		await db.sql`
			INSERT INTO audit_events SELECT gen_random_uuid(), ${at(0)}::timestamptz + g * interval '1 second', 'u', 'u@x',
				'portal', ${p}, null, null, 'route', 'r' || g, 'update', '[]'::jsonb, 'success', null
			FROM generate_series(1, 60) g`;
		const first = await list({ projectId: p });
		expect(first.body.data).toHaveLength(50);
		expect(first.body.nextCursor).toBeString();

		for (const cursor of ["nonsense", Buffer.from("[1,2]").toString("base64url")]) {
			expect((await list({ projectId: p, cursor })).status).toBe(400);
		}
	});

	it("lists a deleted project's rows, flags them, and still filters by its old id", async () => {
		const gone = `deleted_${uniq()}`;
		const kept = await seed({ ts: at(0), projectId: gone, projectName: "Old Shop" });
		const alive = await seed({ ts: at(1), projectId: stack.projectId, projectName: "Live", resourceType: gone });

		const res = await list({ projectId: gone });
		expect(res.body.data).toHaveLength(1);
		expect(res.body.data[0]).toMatchObject({
			id: kept,
			projectId: gone,
			projectName: "Old Shop",
			projectDeleted: true,
		});
		const live = await list({ resourceType: gone });
		expect(live.body.data[0]).toMatchObject({ id: alive, projectDeleted: false });

		const filters = await admin(stack, portal, "GET", `${LIST}/filters`);
		expect(filters.status).toBe(200);
		expect(filters.body.projects).toContainEqual({ id: gone, name: "Old Shop", slug: "Old Shop", deleted: true });
		expect(filters.body.projects.find((x: { id: string }) => x.id === stack.projectId)).toMatchObject({ deleted: false });
	});

	it("keeps the rows of a project deleted through the API readable and filterable", async () => {
		const slug = `real-${uniq()}`;
		const made = await admin(stack, portal, "POST", "/v1/projects", { name: slug, slug });
		const projectId = made.body.id as string;
		await db.waitFor("project_id = $1", 1, projectId);
		expect((await admin(stack, portal, "DELETE", `/v1/projects/${projectId}`)).status).toBe(200);
		await db.waitFor("project_id = $1 AND action = 'delete'", 1, projectId);

		const res = await list({ projectId });
		expect(res.body.data.length).toBeGreaterThanOrEqual(2);
		expect(res.body.data.every((r: { projectDeleted: boolean; projectName: string }) => r.projectDeleted && r.projectName === slug)).toBe(true);
	});

	it("lists the filter options: resource types, actions and projects", async () => {
		const rt = `opt_${uniq()}`;
		await seed({ ts: at(0), resourceType: rt, action: `act_${rt}`, projectId: stack.projectId, projectName: "X" });
		const res = await admin(stack, portal, "GET", `${LIST}/filters`);
		expect(res.status).toBe(200);
		expect(res.body.resourceTypes).toContain(rt);
		expect(res.body.actions).toContain(`act_${rt}`);
		expect(res.body.resourceTypes).toEqual([...res.body.resourceTypes].sort());
		const ids = res.body.projects.map((x: { id: string }) => x.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain(stack.projectId);
	});

	it("does not log that someone read the log", async () => {
		await Bun.sleep(3_000); // let the events of the earlier tests land first
		const before = await db.sql`SELECT count(*)::int AS n FROM audit_events`;
		await list({});
		await admin(stack, portal, "GET", `${LIST}/filters`);
		await Bun.sleep(3_000);
		const after = await db.sql`SELECT count(*)::int AS n FROM audit_events`;
		expect(after[0].n).toBe(before[0].n);
	});
});
