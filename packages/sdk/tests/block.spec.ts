import { describe, expect, it } from "bun:test";
import {
	block,
	blockEntryPath,
	deprecated,
	fluxifyManifestSchema,
	handle,
	ICON_URL_MAX,
	MODULE_BLOCK_DATA_KEYS,
	manifestEntrySchema,
	param,
	toManifestEntry,
} from "../blocks.js";
import { nextVersion } from "../scripts/version.js";

const run = () => ({ output: 1 });
// a loose definition, for the cases the types would reject before runtime
const define = (def: Record<string, unknown>) => () => block({ name: "acme/x/b", label: "B", run, ...def } as any);

const slack = block({
	name: "acme/slack/messages/post",
	label: "Post message",
	icon: "./icon.svg",
	shape: "wide",
	docs: "## When to use it",
	invoke: ["sync"],
	permissions: { integrations: ["kv"], appconfig: true },
	params: {
		mode: param.select({ options: ["simple", "advanced"], default: "simple" }),
		channel: param.string({ required: true, label: "Channel" }),
		conn: param.integration({ kind: "kv" }),
		key: param.appconfig(),
		shape: param.schema({ visibleWhen: { mode: "advanced" } }),
		legacy: deprecated(param.string(), "Ignored since Oct 2026, removed in the Jan 2027 release; use `channel`."),
	},
	handles: {
		in: [handle.in("target")],
		out: [handle.out("success"), handle.out("failure")],
		body: [deprecated(handle.body("tools", "bottom-left", { allowMultiple: true }), "Use `skills`.")],
	},
	async run({ params }) {
		return { output: params, handle: "success" };
	},
});

describe("toManifestEntry", () => {
	it("is the definition minus run, as JSON, and round-trips through the schema", () => {
		const entry = toManifestEntry(slack);
		expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
		expect(manifestEntrySchema.parse(entry)).toEqual(entry);
		expect(entry).toEqual({
			name: "acme/slack/messages/post",
			label: "Post message",
			icon: "./icon.svg",
			shape: "wide",
			docs: "## When to use it",
			invoke: ["sync"],
			permissions: { integrations: ["kv"], appconfig: true },
			params: {
				mode: { type: "select", options: ["simple", "advanced"], default: "simple", order: 0 },
				channel: { type: "string", required: true, label: "Channel", order: 1 },
				conn: { type: "integration", kind: "kv", order: 2 },
				key: { type: "appconfig", order: 3 },
				shape: { type: "schema", visibleWhen: { mode: "advanced" }, order: 4 },
				legacy: {
					type: "string",
					order: 5,
					deprecated: "Ignored since Oct 2026, removed in the Jan 2027 release; use `channel`.",
				},
			},
			handles: {
				in: ["target"],
				out: ["success", "failure"],
				body: [{ name: "tools", corner: "bottom-left", allowMultiple: true }],
				deprecated: { tools: "Use `skills`." },
			},
			deprecated: null,
		});
	});

	it("fills the defaults: square, every invoke mode, target in, source out", () => {
		const entry = toManifestEntry(block({ name: "acme/x/min", label: "Min", run }));
		expect(entry).toMatchObject({
			shape: "square",
			invoke: ["sync", "async", "queued"],
			permissions: {},
			params: {},
			handles: { in: ["target"], out: ["source"], body: [] },
			deprecated: null,
		});
		expect(manifestEntrySchema.parse(entry)).toEqual(entry);
	});

	it("carries a block-level deprecation and keeps run", async () => {
		const old = deprecated(block({ name: "acme/x/old", label: "Old", run }), "Removed in the Jan 2027 release.");
		expect(toManifestEntry(old).deprecated).toBe("Removed in the Jan 2027 release.");
		expect(await old.run({} as any)).toEqual({ output: 1 });
	});
});

describe("block() rejects", () => {
	it.each(MODULE_BLOCK_DATA_KEYS.map((k) => [k]))("the engine's data key %s as a param", (key) => {
		expect(define({ params: { [key]: param.string() } })).toThrow(`param name '${key}' is reserved`);
	});

	it("`all` and `any`, the visibleWhen group words, as params", () => {
		expect(define({ params: { all: param.string() } })).toThrow("param name 'all' is reserved");
		expect(define({ params: { any: param.string() } })).toThrow("param name 'any' is reserved");
	});

	it("`span`, the trace's span type, and malformed names", () => {
		expect(define({ name: "span" })).toThrow("'span' is reserved");
		for (const name of ["acme/x", "Acme/x/b", "acme//b", "acme/x/b/", "/acme/x/b", "acme/x/b c"])
			expect(define({ name })).toThrow("must be scope/name/.../block");
		expect(define({ name: "acme/x/deep/folder/b" })).not.toThrow();
	});

	it("success/failure outputs with async or queued invoke", () => {
		const branching = { out: [handle.out("success"), handle.out("failure")] };
		expect(define({ handles: branching, invoke: ["sync", "queued"] })).toThrow(
			"can only be invoked sync, not queued",
		);
		expect(define({ handles: branching })).toThrow("can only be invoked sync, not async, queued");
		expect(define({ handles: branching, invoke: ["sync"] })).not.toThrow();
	});

	it("body handles without sync invoke", () => {
		const handles = { out: [handle.out("source")], body: [handle.body("each", "top-left")] };
		expect(define({ handles, invoke: ["async"] })).toThrow("must allow sync invoke");
	});

	it("handle names and output shapes R2 does not allow", () => {
		const out = [handle.out("source")];
		expect(define({ handles: { out, in: [handle.in("my-in")] } })).toThrow("must be a plain identifier");
		expect(define({ handles: { out, body: [handle.body("source", "top-left")] } })).toThrow(
			"duplicate handle names: source",
		);
		expect(define({ handles: { out: [handle.out("failure")] } })).toThrow();
		expect(define({ handles: { out: [handle.out("source"), handle.out("failure")] } })).toThrow();
	});

	it("visibleWhen naming a missing param, an uncomparable one, or a value that does not fit", () => {
		const base = { mode: param.select({ options: ["a", "b"] }), on: param.boolean(), j: param.json() };
		const when = (visibleWhen: unknown) => define({ params: { ...base, x: param.string({ visibleWhen } as any) } });
		expect(when({ mood: "a" })).toThrow("visibleWhen names 'mood', which is not a param");
		expect(when({ j: "a" })).toThrow("cannot compare 'j': a json param");
		expect(when({ mode: "c" })).toThrow(`visibleWhen value "c" does not fit param 'mode'`);
		expect(when({ all: [{ mode: "a" }, { any: [{ on: "yes" }] }] })).toThrow(
			`visibleWhen value "yes" does not fit param 'on'`,
		);
		expect(when({ all: [{ mode: ["a", "b"] }, { any: [{ on: true }] }] })).not.toThrow();
	});

	it("an integration or appconfig param the permissions do not grant", () => {
		expect(define({ params: { c: param.integration({ kind: "kv" }) } })).toThrow(
			"permissions.integrations must list 'kv'",
		);
		expect(define({ params: { k: param.appconfig() } })).toThrow("permissions.appconfig must be true");
	});

	it("a select default that is not an option, and a deprecation without a message", () => {
		expect(define({ params: { m: { type: "select", options: ["a"], default: "z" } } })).toThrow(
			"select default must be one of its options",
		);
		expect(() => deprecated(param.string(), " ")).toThrow("needs a message");
	});

	it("names the block in the error", () => {
		expect(define({ name: "acme/x/named", params: { order: param.string() } })).toThrow(/^block acme\/x\/named:/);
	});
});

describe("run", () => {
	const echo = block({
		name: "acme/x/echo",
		label: "Echo",
		params: {
			need: param.string({ required: true }),
			n: param.number({ default: 5 }),
			s: param.schema(),
		},
		run: ({ params }) => ({ output: params }),
	});
	const call = (params: Record<string, unknown>) => echo.run({ params } as any) as { output: unknown };

	it("fills defaults the canvas left empty, and keeps what it set", () => {
		expect(call({ need: "x" }).output).toEqual({ need: "x", n: 5 });
		expect(call({ need: "x", n: 1 }).output).toEqual({ need: "x", n: 1 });
	});

	it("passes an empty schema param as absent", () => {
		expect(call({ need: "x", s: null }).output).toEqual({ need: "x", n: 5 });
	});

	it("fails before run when a required param is missing", () => {
		expect(() => call({})).toThrow("param 'need' is required");
		expect(() => call({ need: null })).toThrow("param 'need' is required");
	});

	it("checks a number's bounds and integerness before run", () => {
		const bounded = block({
			name: "acme/x/bounded",
			label: "Bounded",
			params: { n: param.number({ min: 1, max: 10, integer: true }) },
			run: ({ params }) => ({ output: params.n }),
		});
		const accept = (n: unknown) =>
			(bounded.run({ params: { n } } as any) as { output: unknown }).output;
		expect([accept(1), accept(10)]).toEqual([1, 10]);
		expect(() => accept(0)).toThrow("param 'n' must be at least 1, got 0");
		expect(() => accept(11)).toThrow("param 'n' must be at most 10, got 11");
		expect(() => accept(2.5)).toThrow("param 'n' must be an integer");
		// a fraction is fine when the param does not ask for whole numbers
		const loose = block({
			name: "acme/x/loose",
			label: "Loose",
			params: { n: param.number({ min: 0.5, max: 2 }) },
			run: ({ params }) => ({ output: params.n }),
		});
		expect((loose.run({ params: { n: 1.5 } } as any) as { output: unknown }).output).toBe(1.5);
	});
});

describe("number param bounds", () => {
	it("refuses a min above the max, and a default outside the bounds", () => {
		expect(define({ params: { n: param.number({ min: 5, max: 1 }) } })).toThrow(
			"number min must not be above max",
		);
		expect(define({ params: { n: param.number({ min: 1, max: 10, default: 0 }) } })).toThrow(
			"number default must be at least 1, got 0",
		);
		expect(define({ params: { n: param.number({ max: 10, default: 11 }) } })).toThrow(
			"number default must be at most 10, got 11",
		);
		expect(define({ params: { n: param.number({ integer: true, default: 1.5 }) } })).toThrow(
			"number default must be an integer",
		);
	});

	it("writes them into the manifest entry", () => {
		const entry = toManifestEntry(
			block({
				name: "acme/x/bounded",
				label: "Bounded",
				params: { n: param.number({ min: 1, max: 10, integer: true, default: 5 }) },
				run,
			}),
		);
		expect(entry.params.n).toEqual({
			type: "number",
			min: 1,
			max: 10,
			integer: true,
			default: 5,
			order: 0,
		});
		expect(manifestEntrySchema.parse(entry)).toEqual(entry);
	});
});

describe("nextVersion", () => {
	const on = (iso: string) => new Date(`${iso}T12:00:00Z`);
	it("is YYYY.M.DDNN with no leading zeros, counting releases on a day", () => {
		expect(nextVersion("2026.10.1903", on("2026-10-20"))).toBe("2026.10.2001");
		expect(nextVersion("2026.10.2001", on("2026-10-20"))).toBe("2026.10.2002");
		expect(nextVersion("2026.10.2009", on("2026-10-20"))).toBe("2026.10.2010");
		expect(nextVersion("2026.10.2001", on("2026-11-05"))).toBe("2026.11.501");
		expect(nextVersion("2026.11.501", on("2026-11-05"))).toBe("2026.11.502");
		expect(nextVersion("1.0.0", on("2027-01-01"))).toBe("2027.1.101");
	});
	it("refuses a 100th release on one day", () => {
		expect(() => nextVersion("2026.10.2099", on("2026-10-20"))).toThrow("already 99 releases");
	});
});

describe("fluxifyManifestSchema", () => {
	const entry = toManifestEntry(slack);
	const manifest = (over: Record<string, unknown> = {}, name = entry.name) => ({
		name: "acme/slack",
		url: "https://github.com/acme/fluxify-slack",
		sdk: ">=2026.10.2001",
		blocks: { [name]: { entry: "dist/blocks/messages/post.js", ...entry, name } },
		...over,
	});
	const reason = (m: unknown) => {
		const r = fluxifyManifestSchema.safeParse(m);
		return r.success ? "" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
	};

	it("accepts what the CLI writes", () => {
		expect(fluxifyManifestSchema.safeParse(manifest()).success).toBe(true);
		expect(blockEntryPath("acme/slack/messages/post")).toBe("dist/blocks/messages/post.js");
	});

	it("needs an https url, a scope/name and a version range", () => {
		expect(reason(manifest({ url: "http://example.com" }))).toContain("https");
		expect(reason(manifest({ url: undefined }))).toContain("url");
		expect(reason(manifest({ name: "slack" }))).toContain("scope/name");
		expect(reason(manifest({ sdk: "latest" }))).toContain("version range");
	});

	it("pins each block to its type and to dist/blocks, so a manifest cannot point elsewhere", () => {
		const other = manifest({}, "acme/other/messages/post");
		expect(reason(other)).toContain("is not inside plugin");
		const moved = manifest();
		moved.blocks["acme/slack/messages/post"].entry = "../../etc/passwd";
		expect(reason(moved)).toContain("must be 'dist/blocks/messages/post.js'");
		const keyed = manifest();
		keyed.blocks = { "acme/slack/other": keyed.blocks["acme/slack/messages/post"] };
		expect(reason(keyed)).toContain("is keyed 'acme/slack/other'");
	});

	it("shares the custom block icon limit", () => {
		expect(ICON_URL_MAX).toBe(68266);
	});
});
