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

describe("ephemeral run keys (#741)", () => {
	const m = projectSettingsKeySchemaMap;
	const ok = (k: keyof typeof m, v: string) => m[k].schema.safeParse(v).success;

	it("default to 10 seconds and not asking", () => {
		expect(m["settings.ai.ephemeralRunTimeoutSeconds"].defaultValue).toBe("10");
		expect(m["settings.ai.askBeforeEphemeralRuns"].defaultValue).toBe("false");
	});

	it("keep the timeout inside 1-30 whole seconds", () => {
		const key = "settings.ai.ephemeralRunTimeoutSeconds";
		for (const bad of ["0", "31", "1.5", "-1", "abc"]) expect(ok(key, bad)).toBe(false);
		for (const good of ["1", "10", "30"]) expect(ok(key, good)).toBe(true);
	});

	it("take only true or false for the ask setting", () => {
		expect(ok("settings.ai.askBeforeEphemeralRuns", "true")).toBe(true);
		expect(ok("settings.ai.askBeforeEphemeralRuns", "false")).toBe(true);
		expect(ok("settings.ai.askBeforeEphemeralRuns", "yes")).toBe(false);
	});

	it("are a creator's to change, not only a project admin's", () => {
		for (const key of ["settings.ai.ephemeralRunTimeoutSeconds", "settings.ai.askBeforeEphemeralRuns"])
			expect(() => assertCanWriteKey(user, acl("creator"), "p1", key as never)).not.toThrow();
	});
});

describe("production ask keys (#737)", () => {
	const m = projectSettingsKeySchemaMap;
	const keys = ["settings.ai.askBeforeProductionReads", "settings.ai.askBeforeProductionWrites"] as const;

	it("default to asking", () => {
		for (const key of keys) expect(m[key].defaultValue).toBe("true");
	});

	it("take only true or false", () => {
		for (const key of keys) {
			expect(m[key].schema.safeParse("false").success).toBe(true);
			expect(m[key].schema.safeParse("yes").success).toBe(false);
		}
	});
});
