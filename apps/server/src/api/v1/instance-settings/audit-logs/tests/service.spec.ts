import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { entitlement, type License } from "@fluxify/common/license";
import { ForbiddenError } from "../../../../../errors/forbidError";
import * as edition from "../../../../../lib/edition";
import { decodeCursor, encodeCursor } from "../list/query";
import * as repository from "../list/repository";
import handleRequest, { toAuditRow } from "../list/service";

afterEach(() => mock.restore());

const row = (n: number, projectId: string | null = "p1") => ({
	id: `019a0000-0000-7000-8000-${String(n).padStart(12, "0")}`,
	ts: new Date(Date.UTC(2026, 9, 17, 10, 0, 0, 0) - n * 1000),
	actorId: "u1",
	actorEmail: "a@x.io",
	source: "pat",
	projectId,
	projectName: "Shop",
	projectSlug: "shop",
	resourceType: "route",
	resourceId: `r${n}`,
	action: "update",
	changedFields: ["name"],
	status: "success",
	message: null,
});

describe("audit row mapping", () => {
	it("marks a project that no longer exists as deleted, and keeps its snapshot", () => {
		const out = toAuditRow(row(1, "gone"), new Set(["p1"]));
		expect(out).toMatchObject({ projectDeleted: true, projectName: "Shop", projectSlug: "shop" });
	});

	it("does not mark a project that still exists", () => {
		expect(toAuditRow(row(1), new Set(["p1"])).projectDeleted).toBe(false);
	});

	it("never marks an instance-level event as deleted", () => {
		expect(toAuditRow(row(1, null), new Set()).projectDeleted).toBe(false);
	});

	it("serialises the time as ISO", () => {
		expect(toAuditRow(row(0), new Set(["p1"])).ts).toBe("2026-10-17T10:00:00.000Z");
	});
});

const license = (l: License) => entitlement(l);
const refusal = (l: License) => {
	try {
		edition.assertCanReadAudit(license(l));
	} catch (e) {
		return e;
	}
};

describe("audit log read gate", () => {
	it("refuses community, and says it needs Enterprise", () => {
		const e = refusal({ kind: "community" });
		expect(e).toBeInstanceOf(ForbiddenError);
		expect((e as Error).message).toBe("Audit logs need an enterprise license");
	});

	it("refuses a signed key without the feature", () => {
		const e = refusal({ kind: "signed", licensee: "A", expiresAt: null, features: ["sso"] });
		expect((e as Error).message).toBe("Your license does not include audit logs");
	});

	it("lets the non-commercial tier and a key with the feature read", () => {
		expect(refusal({ kind: "non_commercial" })).toBeUndefined();
		expect(
			refusal({ kind: "signed", licensee: "A", expiresAt: null, features: ["auditLogs"] }),
		).toBeUndefined();
	});

	it("keeps old events readable after the licence is past its grace period", () => {
		const long = new Date(Date.now() - 400 * 86_400_000).toISOString();
		const lapsed: License = { kind: "signed", licensee: "A", expiresAt: long, features: ["auditLogs"] };
		expect(license(lapsed).canRun).toBe(false);
		expect(refusal(lapsed)).toBeUndefined();
	});

	it("is checked before the database is touched", async () => {
		const list = spyOn(repository, "listAuditEvents");
		// no licence has been published in a unit test: community
		await expect(handleRequest({ limit: 50 })).rejects.toBeInstanceOf(ForbiddenError);
		expect(list).not.toHaveBeenCalled();
	});
});

describe("audit log list", () => {
	const open = () => spyOn(edition, "assertCanReadAudit").mockImplementation(() => {});

	it("returns a page and a cursor that points at its last row when more follow", async () => {
		open();
		const rows = [row(1), row(2), row(3)];
		const list = spyOn(repository, "listAuditEvents").mockResolvedValue(rows as never);
		spyOn(repository, "existingProjectIds").mockResolvedValue(new Set(["p1"]));
		const out = await handleRequest({ limit: 2 });
		expect(list.mock.calls[0]![2]).toBe(3); // asks for one extra
		expect(out.data.map((r) => r.resourceId)).toEqual(["r1", "r2"]);
		expect(decodeCursor(out.nextCursor!)).toEqual({ ts: rows[1]!.ts, id: rows[1]!.id });
	});

	it("has no cursor on the last page", async () => {
		open();
		spyOn(repository, "listAuditEvents").mockResolvedValue([row(1), row(2)] as never);
		spyOn(repository, "existingProjectIds").mockResolvedValue(new Set());
		expect((await handleRequest({ limit: 2 })).nextCursor).toBeNull();
	});

	it("looks the projects up once for the whole page", async () => {
		open();
		spyOn(repository, "listAuditEvents").mockResolvedValue([row(1), row(2, "p2"), row(3), row(4, null)] as never);
		const lookup = spyOn(repository, "existingProjectIds").mockResolvedValue(new Set(["p1"]));
		const out = await handleRequest({ limit: 10 });
		expect(lookup).toHaveBeenCalledTimes(1);
		expect(lookup.mock.calls[0]![0].sort()).toEqual(["p1", "p2"]);
		expect(out.data.map((r) => r.projectDeleted)).toEqual([false, true, false, false]);
	});

	it("passes the decoded cursor and the filters on, and rejects a bad cursor with 400", async () => {
		open();
		const list = spyOn(repository, "listAuditEvents").mockResolvedValue([] as never);
		spyOn(repository, "existingProjectIds").mockResolvedValue(new Set());
		const ts = new Date("2026-10-17T09:00:00.000Z");
		const id = "019a0000-0000-7000-8000-000000000009";
		await handleRequest({ limit: 5, projectId: "p9", cursor: encodeCursor(ts, id) });
		expect(list.mock.calls[0]![0]).toEqual({ projectId: "p9" });
		expect(list.mock.calls[0]![1]).toEqual({ ts, id });
		await expect(handleRequest({ limit: 5, cursor: "garbage" })).rejects.toMatchObject({
			httpCode: 400,
		});
	});
});
