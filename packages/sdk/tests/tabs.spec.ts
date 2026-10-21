import { describe, expect, it } from "bun:test";
import { block, GENERAL_TAB, hint, paramTabs, param, toManifestEntry } from "../blocks.js";

const run = () => ({ output: 1 });
const s = (o: object = {}) => ({ type: "string", ...o });

describe("paramTabs", () => {
	it("is one General tab in declaration order for a manifest without tab or order", () => {
		expect(paramTabs({ b: s(), a: s(), c: s() })).toEqual([{ name: GENERAL_TAB, params: ["b", "a", "c"] }]);
	});

	it("sorts by order, then the params without one in declaration order", () => {
		const params = { a: s(), b: s({ order: 2 }), c: s(), d: s({ order: 1 }), e: s() };
		expect(paramTabs(params)[0]!.params).toEqual(["d", "b", "a", "c", "e"]);
	});

	it("lists tabs in order of first use, General first", () => {
		const params = { a: s({ tab: "Auth" }), b: s({ tab: "Advanced" }), c: s(), d: s({ tab: "Auth" }) };
		expect(paramTabs(params)).toEqual([
			{ name: "General", params: ["c"] },
			{ name: "Auth", params: ["a", "d"] },
			{ name: "Advanced", params: ["b"] },
		]);
	});

	it("follows explicit tabs, then appends a tab they leave out", () => {
		const params = { a: s({ tab: "Auth" }), b: s({ tab: "Extra" }), c: s() };
		expect(paramTabs(params, ["Auth", "General"]).map((t) => t.name)).toEqual(["Auth", "General", "Extra"]);
		// General leads when the list leaves it out
		expect(paramTabs(params, ["Auth"]).map((t) => t.name)).toEqual(["General", "Auth", "Extra"]);
	});

	it("places hints with the params", () => {
		const params = { a: s(), note: { type: "hint", order: 0 }, b: s() };
		expect(paramTabs(params)[0]!.params).toEqual(["note", "a", "b"]);
	});
});

describe("toManifestEntry placement", () => {
	it("writes each param's resolved position and the tabs, so the portal never reads key order", () => {
		const entry = toManifestEntry(
			block({
				name: "acme/x/b",
				label: "B",
				tabs: ["Auth"],
				params: {
					url: param.string({ order: 5 }),
					token: param.string({ tab: "Auth" }),
					note: hint("Tokens live in **Settings**.", { tab: "Auth", order: -1, tone: "tip" }),
					retries: param.number({ order: 1 }),
				},
				run,
			}),
		);
		expect(entry.tabs).toEqual(["General", "Auth"]);
		expect(entry.params).toEqual({
			url: { type: "string", order: 1 },
			token: { type: "string", tab: "Auth", order: 1 },
			note: { type: "hint", text: "Tokens live in **Settings**.", tab: "Auth", order: 0, tone: "tip" },
			retries: { type: "number", order: 0 },
		});
	});

	it("writes no tabs when everything is in General", () => {
		expect(toManifestEntry(block({ name: "acme/x/b", label: "B", params: { a: param.string() }, run })).tabs).toBeUndefined();
	});

	it("refuses a tabs entry no param uses; a hint alone does not count", () => {
		const define = (tabs: string[], params: object) => () => block({ name: "acme/x/b", label: "B", tabs, params, run } as never);
		expect(define(["Auth", "Ghost"], { a: param.string({ tab: "Auth" }) })).toThrow("tabs lists 'Ghost', which no param uses");
		expect(define(["Help"], { a: param.string(), h: hint("x", { tab: "Help" }) })).toThrow("tabs lists 'Help'");
	});
});

describe("hint", () => {
	it("is no value: run never gets it, and visibleWhen cannot compare it", () => {
		const b = block({
			name: "acme/x/h",
			label: "H",
			params: { note: hint("Read me"), a: param.string() },
			run: ({ params }) => ({ output: params }),
		});
		expect((b.run({ params: { note: "x", a: "1" } } as never) as { output: unknown }).output).toEqual({ a: "1" });
		const bad = () =>
			block({ name: "acme/x/h", label: "H", params: { note: hint("x"), a: param.string({ visibleWhen: { note: "x" } as never }) }, run });
		expect(bad).toThrow("cannot compare 'note': a hint param");
	});
});
