import { expect, test } from "bun:test";
import { resolveActiveTab } from "./activeTab";

const all = ["general", "backup", "danger"] as const;
const base = { all, fallback: "general" } as const;

test("a refresh on a gated tab keeps it while the session is still loading", () => {
	// nothing gated is visible yet, exactly as on the first render after a refresh
	expect(
		resolveActiveTab({ ...base, requested: "backup", visible: ["general"], authReady: false }),
	).toBe("backup");
});

test("once the session has loaded, a tab the user can't see falls back", () => {
	expect(
		resolveActiveTab({ ...base, requested: "backup", visible: ["general"], authReady: true }),
	).toBe("general");
	expect(
		resolveActiveTab({
			...base,
			requested: "backup",
			visible: ["general", "backup"],
			authReady: true,
		}),
	).toBe("backup");
});

test("a missing or unknown tab is General, loaded or not", () => {
	for (const authReady of [true, false])
		for (const requested of [undefined, "", "nope"])
			expect(resolveActiveTab({ ...base, requested, visible: all, authReady })).toBe("general");
});
