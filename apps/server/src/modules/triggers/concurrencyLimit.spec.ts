import { describe, expect, it } from "bun:test";
import { ForbiddenError } from "../../errors/forbidError";
import { projectSettingsKeySchemaMap } from "../../api/v1/projects/settings/keys/keySchemaMap";
import { assertCanWriteKey } from "../../api/v1/projects/settings/keys/upsert/guard";
import { DEFAULT_TRIGGER_CONCURRENCY, TRIGGER_CONCURRENCY_KEY, triggerConcurrency } from "./concurrencyLimit";

const schema = projectSettingsKeySchemaMap[TRIGGER_CONCURRENCY_KEY];
const acl = (role: string) => [{ projectId: "p1", role }] as never;
const user = { isSystemAdmin: false } as never;

describe("Trigger Workflow concurrency setting", () => {
	it("defaults to 10", () => {
		expect(schema.defaultValue).toBe("10");
		expect(triggerConcurrency(undefined)).toBe(DEFAULT_TRIGGER_CONCURRENCY);
		expect(triggerConcurrency({})).toBe(10);
	});

	it("accepts whole numbers from 1 to 100 only", () => {
		for (const bad of ["0", "101", "1.5", "-1", "abc"]) expect(schema.schema.safeParse(bad).success).toBe(false);
		for (const good of ["1", "10", "100"]) expect(schema.schema.safeParse(good).success).toBe(true);
	});

	it("reads the saved value, and falls back to the default for one that cannot be used", () => {
		expect(triggerConcurrency({ [TRIGGER_CONCURRENCY_KEY]: "25" })).toBe(25);
		expect(triggerConcurrency({ [TRIGGER_CONCURRENCY_KEY]: "1" })).toBe(1);
		expect(triggerConcurrency({ [TRIGGER_CONCURRENCY_KEY]: "nope" })).toBe(10);
		expect(triggerConcurrency({ [TRIGGER_CONCURRENCY_KEY]: "" })).toBe(10);
	});

	it("clamps a stored value that is outside the range", () => {
		expect(triggerConcurrency({ [TRIGGER_CONCURRENCY_KEY]: "0" })).toBe(1);
		expect(triggerConcurrency({ [TRIGGER_CONCURRENCY_KEY]: "500" })).toBe(100);
	});

	it("is a project admin's to change", () => {
		expect(() => assertCanWriteKey(user, acl("project_admin"), "p1", TRIGGER_CONCURRENCY_KEY)).not.toThrow();
		for (const role of ["creator", "viewer"])
			expect(() => assertCanWriteKey(user, acl(role), "p1", TRIGGER_CONCURRENCY_KEY)).toThrow(ForbiddenError);
	});
});
