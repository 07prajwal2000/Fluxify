import { describe, expect, it } from "bun:test";
import { ForbiddenError } from "../../../../../../../errors/forbidError";
import { projectSettingsKeySchemaMap } from "../../keySchemaMap";
import { assertCanWriteKey } from "../guard";

const user = { isSystemAdmin: false } as any;
const acl = (role: string) => [{ projectId: "p1", role }] as any;

describe("agent limit keys", () => {
	it("default when unset", () => {
		const m = projectSettingsKeySchemaMap;
		expect(m["settings.ai.maxSteps"].defaultValue).toBe("40");
		expect(m["settings.ai.maxContextTokens"].defaultValue).toBe("128000");
		expect(m["settings.ai.tokenBudget"].defaultValue).toBe("1000000");
	});

	it("enforce bounds", () => {
		const ok = (k: keyof typeof projectSettingsKeySchemaMap, v: string) =>
			projectSettingsKeySchemaMap[k].schema.safeParse(v).success;
		expect(ok("settings.ai.maxSteps", "0")).toBe(false);
		expect(ok("settings.ai.maxSteps", "201")).toBe(false);
		expect(ok("settings.ai.maxSteps", "1.5")).toBe(false);
		expect(ok("settings.ai.maxSteps", "200")).toBe(true);
		expect(ok("settings.ai.maxContextTokens", "7999")).toBe(false);
		expect(ok("settings.ai.maxContextTokens", "2000001")).toBe(false);
		expect(ok("settings.ai.maxContextTokens", "8000")).toBe(true);
		expect(ok("settings.ai.tokenBudget", "9999")).toBe(false);
		expect(ok("settings.ai.tokenBudget", "10000")).toBe(true);
	});
});

describe("assertCanWriteKey", () => {
	it("lets only project_admin write agent limits", () => {
		expect(() => assertCanWriteKey(user, acl("project_admin"), "p1", "settings.ai.maxSteps")).not.toThrow();
		for (const role of ["creator", "viewer"])
			expect(() => assertCanWriteKey(user, acl(role), "p1", "settings.ai.tokenBudget")).toThrow(ForbiddenError);
	});

	it("leaves other keys to the route's creator check", () => {
		expect(() => assertCanWriteKey(user, acl("creator"), "p1", "settings.triggers.maxPayloadBytes")).not.toThrow();
	});
});
