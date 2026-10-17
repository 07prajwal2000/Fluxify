import { describe, expect, it } from "bun:test";
import { buildEvent, sanitizeFields, scrubMessage } from "../event";
import { bodyFields, changedFields } from "../fields";
import { auditEventSchema } from "../types";

describe("changedFields", () => {
	it("lists the names that differ and never a value", () => {
		const names = changedFields(
			{ name: "a", config: { password: "old-secret", host: "h" }, tags: [1] },
			{ name: "a", config: { password: "new-secret", host: "h" }, tags: [1, 2] },
		);
		expect(names.sort()).toEqual(["config.password", "tags"]);
		expect(JSON.stringify(names)).not.toContain("secret");
	});

	it("ignores a field the request leaves out", () => {
		expect(changedFields({ a: 1, b: 2 }, { a: 1 })).toEqual([]);
	});

	it("lists a field that is new", () => {
		expect(changedFields({}, { token: "x" })).toEqual(["token"]);
	});
});

describe("bodyFields", () => {
	it("lists the names present in a request body", () => {
		expect(bodyFields({ name: "n", password: "p", skipped: undefined })).toEqual([
			"name",
			"password",
		]);
	});

	it("is empty for anything that is not an object", () => {
		expect(bodyFields(null)).toEqual([]);
		expect(bodyFields([1, 2])).toEqual([]);
	});
});

describe("sanitizeFields", () => {
	it("keeps property names, sorted and unique", () => {
		expect(sanitizeFields(["b", "a", "a", "config.api-key", "headers[0]"])).toEqual([
			"a",
			"b",
			"config.api-key",
			"headers[0]",
		]);
	});

	it("drops anything that reads as a value", () => {
		expect(sanitizeFields(["hunter two", "a@b.c", "x".repeat(101), "", "ok"])).toEqual(["ok"]);
	});
});

describe("scrubMessage", () => {
	it.each([
		["token flx_abcdefghijklmnop leaked", "flx_abcdefghijklmnop"],
		["agent fxa_abcdefghijklmnop leaked", "fxa_abcdefghijklmnop"],
		["sent Authorization: Bearer abc.def.ghi", "abc.def.ghi"],
		["api_key=sk-live-12345", "sk-live-12345"],
		["connect postgres://user:pa55@host/db failed", "pa55"],
		["key QWxhZGRpbjpvcGVuIHNlc2FtZVFXRVJUWTEyMzQ1Ng== bad", "QWxhZGRpbjpvcGVuIHNlc2FtZVFXRVJUWTEyMzQ1Ng"],
	])("redacts %s", (input, secret) => {
		const out = scrubMessage(input);
		expect(out).not.toContain(secret);
		expect(out).toContain("[redacted]");
	});

	it("leaves an ordinary reason alone", () => {
		expect(scrubMessage("connect ECONNREFUSED 10.0.0.1:5432")).toBe(
			"connect ECONNREFUSED 10.0.0.1:5432",
		);
	});

	it("cuts a very long message", () => {
		expect(scrubMessage("word ".repeat(400)).length).toBeLessThanOrEqual(500);
	});
});

describe("buildEvent", () => {
	const actor = { actorId: "u1", actorEmail: "a@b.c", source: "pat" as const };

	it("builds an event the consumer accepts", () => {
		const event = buildEvent(
			{ resourceType: "route", resourceId: "r1", action: "create", changedFields: ["name"] },
			{ name: "Shop", slug: "shop" },
			actor,
			"p1",
		);
		expect(auditEventSchema.safeParse(event).success).toBe(true);
		expect(event.message).toBeUndefined();
	});

	it("is instance-level without a project", () => {
		const event = buildEvent(
			{ resourceType: "user", resourceId: "u2", action: "delete", changedFields: [] },
			null,
			actor,
			null,
		);
		expect(event).toMatchObject({ projectId: null, projectName: null, projectSlug: null });
		expect(auditEventSchema.safeParse(event).success).toBe(true);
	});

	it("gives every event its own id", () => {
		const make = () =>
			buildEvent(
				{ resourceType: "route", resourceId: "r", action: "update", changedFields: [] },
				null,
				actor,
				null,
			).id;
		expect(make()).not.toBe(make());
	});
});
