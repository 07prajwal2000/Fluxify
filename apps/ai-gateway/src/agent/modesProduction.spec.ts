import { describe, expect, it } from "bun:test";
import type { Approval } from "./agent";
import { run } from "./modes.fixture";
import { deploymentDescription } from "./deployment";
import { needsApproval, touchesProd } from "./tools";

describe("production asks (#737)", () => {
	const call = (name: string, args: object) => `${name}|${JSON.stringify(args)}`;

	it("auto: a production log read asks, a development one does not", async () => {
		const r = await run(
			[[call("get_system_logs", { env: "production" }), call("get_system_logs", { env: "development" }), "get_system_logs"]],
			"auto",
		);
		expect(r.asked).toEqual(["get_system_logs"]);
		expect(r.ran).toHaveLength(3);
	});

	it("get asks for production app config and integrations only", async () => {
		const prod = (type: string) => call("get", { type, env: "production" });
		const r = await run(
			[[prod("app_config"), prod("integration"), prod("route"), call("get", { type: "app_config" })]],
			"auto",
		);
		expect(r.asked).toEqual(["get", "get"]);
	});

	it("save_app_config asks with value, not with only devValue or syncDev", async () => {
		const r = await run(
			[[
				call("save_app_config", { value: "x" }),
				call("save_app_config", { devValue: "x" }),
				call("save_app_config", { syncDev: true }),
			]],
			"auto",
		);
		expect(r.asked).toEqual(["save_app_config"]);
		expect(r.ran).toHaveLength(3);
	});

	it("save_integration asks with config, not with only devConfig", async () => {
		const r = await run(
			[[call("save_integration", { devConfig: {} }), call("save_integration", { config: {} })]],
			"auto",
		);
		expect(r.asked).toEqual(["save_integration"]);
	});

	it("save_trigger always asks, in auto too", async () => {
		expect((await run([["save_trigger"]], "auto")).asked).toEqual(["save_trigger"]);
	});

	it("each setting off turns off only its own asks", async () => {
		const steps = [[call("get_system_logs", { env: "production" }), "save_trigger"]];
		const noReads = await run(steps, "auto", () => ({ ok: true }), { askBeforeProductionReads: false });
		expect(noReads.asked).toEqual(["save_trigger"]);
		const noWrites = await run(steps, "auto", () => ({ ok: true }), { askBeforeProductionWrites: false });
		expect(noWrites.asked).toEqual(["get_system_logs"]);
		const none = await run(steps, "auto", () => ({ ok: true }), {
			askBeforeProductionReads: false,
			askBeforeProductionWrites: false,
		});
		expect(none.asked).toEqual([]);
	});

	it("'always' covers production reads, never production writes", async () => {
		const always = (): Approval => ({ ok: true, always: true });
		const read = call("get_system_logs", { env: "production" });
		const reads = await run([[read], [read]], "auto", always, { allowed: new Set() });
		expect(reads.asked).toEqual(["get_system_logs"]);

		const allowed = new Set<string>();
		const write = call("save_app_config", { value: "x" });
		const writes = await run([[write], [write]], "auto", always, { allowed });
		expect(writes.asked).toEqual(["save_app_config", "save_app_config"]);
		expect([...allowed]).toEqual([]);
	});

	it("an 'always' on a development-only save does not cover a later production value", async () => {
		const always = (): Approval => ({ ok: true, always: true });
		const steps = [[call("save_app_config", { devValue: "x" })], [call("save_app_config", { value: "y" })]];
		const r = await run(steps, "manual", always, { allowed: new Set() });
		expect(r.asked).toEqual(["save_app_config", "save_app_config"]);
	});
});

describe("promote and rollback (#739)", () => {
	const deploys = ["promote_version", "rollback_version"];

	it("ask in every mode and are production writes whatever the settings say", () => {
		for (const name of deploys) {
			expect(touchesProd(name, {})).toBe("write");
			for (const mode of ["manual", "auto"] as const) {
				expect(needsApproval(mode, name)).toBe(true);
				expect(needsApproval(mode, name, false, {}, { reads: false, writes: false })).toBe(true);
			}
		}
	});

	it("ask in auto, with every production setting off", async () => {
		const r = await run([deploys], "auto", () => ({ ok: true }), {
			askBeforeProductionReads: false,
			askBeforeProductionWrites: false,
		});
		expect(r.asked).toEqual(deploys);
		expect(r.ran).toEqual(deploys);
	});

	it("are never approved for the session, even when the user says always", async () => {
		const allowed = new Set<string>();
		const always = (): Approval => ({ ok: true, always: true });
		const r = await run([["promote_version"], ["promote_version"]], "manual", always, { allowed });
		expect(r.asked).toEqual(["promote_version", "promote_version"]);
		expect([...allowed]).toEqual([]);
	});
});

describe("deploymentDescription (#739)", () => {
	it("is the person's comment, with the agent's note after it", () => {
		expect(deploymentDescription("Fixes the 500s", "Adds a retry")).toBe(
			"Fixes the 500s\n\nAgent: Adds a retry",
		);
		expect(deploymentDescription("  Fixes the 500s  ")).toBe("Fixes the 500s");
		expect(deploymentDescription("Fixes", "  ")).toBe("Fixes");
	});

	it("falls back to the note alone, then to a fixed line, for a client with no approval box", () => {
		expect(deploymentDescription(undefined, "Adds a retry")).toBe("Agent: Adds a retry");
		expect(deploymentDescription()).toBe("Deployed by an agent");
	});
});
