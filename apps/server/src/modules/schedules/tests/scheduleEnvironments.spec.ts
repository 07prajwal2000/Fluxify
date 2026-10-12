// The per-environment schedule decision (#777): a schedule fires in each
// environment its workflow is live in, and in no other. The rule is the same
// one the compiler uses to publish a workflow (#738, #739), so every switch
// combination is worth pinning down. This is the pure half; the broker half —
// that the schedule actually lands in the right namespace — is a container test.
import { describe, expect, it } from "bun:test";
import type { FluxifyEnv } from "../../../lib/env";
import type { EnvSwitches } from "../../compiler/observability";
import { scheduleEnvironments } from "../reconciler";

type Trigger = { active: boolean; workflowId: string | null; schedule: string | null };

const switches = (over: Partial<EnvSwitches> = {}): EnvSwitches => ({
	active: false,
	devActive: false,
	prodVersionId: null,
	...over,
});

const trigger = (over: Partial<Trigger> = {}): Trigger => ({
	active: true,
	workflowId: "w1",
	schedule: "@every 1m",
	...over,
});

const cases: Array<[string, Trigger, EnvSwitches | null, FluxifyEnv[]]> = [
	// a trigger with nothing to start fires nowhere
	["switched off", trigger({ active: false }), switches({ active: true, devActive: true, prodVersionId: "v1" }), []],
	["no workflow attached", trigger({ workflowId: null }), switches({ active: true, devActive: true, prodVersionId: "v1" }), []],
	["no schedule", trigger({ schedule: null }), switches({ active: true, devActive: true, prodVersionId: "v1" }), []],
	["workflow row missing", trigger(), null, []],
	// development is `devActive` alone
	["devActive on, production off", trigger(), switches({ devActive: true }), ["development"]],
	["devActive on, active on, never promoted", trigger(), switches({ active: true, devActive: true }), ["development"]],
	["devActive on, active on, promoted", trigger(), switches({ active: true, devActive: true, prodVersionId: "v1" }), ["production", "development"]],
	["active null, devActive on", trigger(), switches({ active: null, devActive: true }), ["development"]],
	// production is `active` AND a promoted version
	["active on, promoted, devActive off", trigger(), switches({ active: true, prodVersionId: "v1" }), ["production"]],
	["active on, never promoted", trigger(), switches({ active: true }), []],
	["active on, promoted, devActive off is not dev", trigger(), switches({ active: true, prodVersionId: "v1", devActive: false }), ["production"]],
	// neither switch on
	["both off", trigger(), switches(), []],
	["everything off but a version", trigger(), switches({ prodVersionId: "v1" }), []],
];

describe("scheduleEnvironments", () => {
	for (const [name, trig, workflow, want] of cases) {
		it(`${name} -> [${want.join(", ") || "none"}]`, () => {
			expect(scheduleEnvironments(trig, workflow)).toEqual(want);
		});
	}
});
