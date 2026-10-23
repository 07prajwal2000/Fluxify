import { describe, expect, it } from "bun:test";
import { triggerEntryPath } from "@fluxify/sdk/triggers";
import { diffManifests } from "../diff";
import { requestedPermissions } from "../meta";
import type { TriggerUser } from "../triggerUsage";
import { manifest } from "./fixtures";

const NAME = "acme/pg";
const KIND = `${NAME}/poller`;

const trigger = (over: Record<string, unknown> = {}) => ({
	name: KIND,
	label: "Poller",
	icon: "data:image/svg+xml;base64,PHN2Zy8+",
	permissions: { integrations: ["database"] },
	params: { table: { type: "string", required: true }, every: { type: "number", default: 5 } },
	retry: false,
	entry: triggerEntryPath(KIND),
	...over,
});
const withTriggers = (...triggers: ReturnType<typeof trigger>[]) =>
	({ ...manifest(NAME, []), triggers }) as never;
const row = (params: string[], id = "t1"): TriggerUser => ({ id, name: id, kind: KIND, params });

const diff = (before: ReturnType<typeof trigger>, after: ReturnType<typeof trigger>, users = [row(["table"])]) =>
	diffManifests(withTriggers(before), withTriggers(after), [], [], users);

describe("upgrade diff: triggers", () => {
	it("a removed kind blocks only while rows of it exist", () => {
		const used = diffManifests(withTriggers(trigger()), withTriggers(), [], [], [row(["table"])]);
		expect(used.removedTriggers).toEqual([{ kind: KIND, usedBy: [{ id: "t1", name: "t1" }] }]);
		expect(used.blocking).toBe(true);
		expect(used.blockers).toEqual([`trigger kind ${KIND} is removed but used by trigger "t1"`]);
		expect(diffManifests(withTriggers(trigger()), withTriggers(), [], [], []).blocking).toBe(false);
	});

	it("a new required param breaks the rows without it; a new optional one breaks nothing", () => {
		const required = diff(trigger(), trigger({ params: { ...trigger().params, schema: { type: "string", required: true } } }));
		expect(required.changedTriggers).toEqual([
			{ kind: KIND, change: "required param schema added", breaking: true, usedBy: [{ id: "t1", name: "t1" }] },
		]);
		expect(required.blocking).toBe(true);
		const optional = diff(trigger(), trigger({ params: { ...trigger().params, schema: { type: "string" } } }));
		expect(optional.changedTriggers).toEqual([
			{ kind: KIND, change: "optional param schema added", breaking: false, usedBy: [] },
		]);
		expect(optional.blocking).toBe(false);
	});

	it("a retyped or removed param breaks the rows that set it, not the others", () => {
		const retyped = trigger({ params: { table: { type: "number" }, every: { type: "number", default: 5 } } });
		expect(diff(trigger(), retyped).blocking).toBe(true);
		expect(diff(trigger(), retyped).changedTriggers[0]).toMatchObject({
			change: "param table changed type from string to number",
			breaking: true,
		});
		// `every` was never set by the row: listed as breaking, but nothing it would break
		const removed = diff(trigger(), trigger({ params: { table: { type: "string", required: true } } }));
		expect(removed.changedTriggers).toEqual([
			{ kind: KIND, change: "param every removed", breaking: true, usedBy: [] },
		]);
		expect(removed.blocking).toBe(false);
	});

	it("a param switched between secret and plain breaks the rows that set it", () => {
		const before = trigger({ params: { password: { type: "secret" } } });
		const after = trigger({ params: { password: { type: "string" } } });
		const result = diff(before, after, [row(["password"])]);
		expect(result.changedTriggers[0]).toMatchObject({
			change: "param password changed between secret and plain",
			breaking: true,
			usedBy: [{ id: "t1" }],
		});
		expect(result.blocking).toBe(true);
	});

	it("a narrowed grant breaks every row of the kind; a wider one only asks for more", () => {
		const narrowed = diff(trigger(), trigger({ permissions: {} }));
		expect(narrowed.changedTriggers).toEqual([
			{ kind: KIND, change: "no longer granted database", breaking: true, usedBy: [{ id: "t1", name: "t1" }] },
		]);
		expect(narrowed.blocking).toBe(true);
		const wider = diff(trigger(), trigger({ permissions: { integrations: ["database", "kv"] } }));
		expect(wider.blocking).toBe(false);
		expect(wider.addedPermissions.integrations).toEqual(["kv"]);
	});

	it("shows a retry change, and breaks nothing with it or with label, icon or description", () => {
		const result = diff(trigger(), trigger({ retry: true, label: "New", description: "d", icon: "data:x" }));
		expect(result.changedTriggers).toEqual([
			{ kind: KIND, change: "retry turned on", breaking: false, usedBy: [{ id: "t1", name: "t1" }] },
		]);
		expect(result.blocking).toBe(false);
	});

	it("lists a new kind as added", () => {
		const other = trigger({ name: `${NAME}/other`, entry: triggerEntryPath(`${NAME}/other`) });
		const result = diffManifests(withTriggers(trigger()), withTriggers(trigger(), other), [], [], []);
		expect(result.addedTriggers).toEqual([`${NAME}/other`]);
		expect(result.blocking).toBe(false);
	});
});

describe("requested permissions", () => {
	it("include what the triggers ask for", () => {
		expect(requestedPermissions(withTriggers(trigger({ permissions: { integrations: ["kv"], appconfig: true } })))).toEqual({
			integrations: ["kv"],
			appconfig: true,
		});
	});
});
