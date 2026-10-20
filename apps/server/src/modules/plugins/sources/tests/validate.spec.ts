import { describe, expect, it } from "bun:test";
import { ICON_URL_MAX } from "@fluxify/sdk/blocks";
import { entry, manifest } from "../../tests/fixtures";
import { MAX_ENTRIES, MAX_UNPACKED_BYTES } from "../limits";
import { untar } from "../tar";
import { validatePlugin } from "../validate";
import { NAME, packageWith, pluginFiles, pluginTgz, rawTgz, VERSION } from "./tarball";

type Over = Parameters<typeof pluginFiles>[0];
const files = (over: Over = {}) =>
	new Map(
		Object.entries(pluginFiles(over)).map(([k, v]) => [k, new TextEncoder().encode(String(v))]),
	);
const rejectsAsync = (promise: Promise<unknown>, message: string) =>
	expect(promise).rejects.toThrow(message);
const rejects = (run: () => unknown, message: string) => expect(run).toThrow(message);

describe("a valid plugin", () => {
	it("unpacks below its top-level folder and validates", async () => {
		const unpacked = await untar(pluginTgz());
		expect([...unpacked.keys()].sort()).toEqual([
			"bun.lock",
			"dist/blocks/step.js",
			"fluxify.json",
			"package.json",
		]);
		const { manifest: m, version } = validatePlugin(unpacked);
		expect(m.name).toBe(NAME);
		expect(version).toBe(VERSION);
	});
});

describe("tarball rejections", () => {
	const evil = (name: string, extra = {}) =>
		rawTgz([{ name: "package/package.json", data: "{}" }, { name, data: "x", ...extra }]);

	it("a path that climbs out with ..", () =>
		rejectsAsync(untar(evil("package/../../etc/passwd")), "unsafe path"));
	it("an absolute path", () => rejectsAsync(untar(evil("/etc/passwd")), "unsafe path"));
	it("a drive path", () => rejectsAsync(untar(evil("C:/Windows/x")), "unsafe path"));
	it("a backslash path", () => rejectsAsync(untar(evil("package\\..\\x")), "unsafe path"));
	it("a symlink", () =>
		rejectsAsync(
			untar(evil("package/link", { type: "2", link: "/etc/passwd", data: "" })),
			"symbolic link",
		));
	it("a hard link", () =>
		rejectsAsync(
			untar(evil("package/h", { type: "1", link: "package/package.json", data: "" })),
			"hard link",
		));
	it("a device file", () =>
		rejectsAsync(untar(evil("package/dev", { type: "3", data: "" })), "device file"));
	it("a second top-level folder", () =>
		rejectsAsync(
			untar(
				rawTgz([
					{ name: "package/a", data: "1" },
					{ name: "other/b", data: "2" },
				]),
			),
			"single top-level folder",
		));
	it("a file twice", () =>
		rejectsAsync(
			untar(
				rawTgz([
					{ name: "package/a", data: "1" },
					{ name: "package/a", data: "2" },
				]),
			),
			"twice",
		));
	it("too many entries", () =>
		rejectsAsync(
			untar(
				rawTgz(Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ name: `package/f${i}` }))),
			),
			"more than",
		));
	it("a zip bomb, before it is inflated", () =>
		rejectsAsync(
			untar(rawTgz([{ name: "package/big", data: new Uint8Array(MAX_UNPACKED_BYTES + 1024) }])),
			"unpacks to more than",
		));
	it("something that is not a tgz", () =>
		rejectsAsync(untar(new TextEncoder().encode("hello")), "not a valid .tgz"));
	it("a truncated archive", async () => {
		const tgz = rawTgz([{ name: "package/a", data: "x".repeat(2000) }]);
		const tar = Bun.gunzipSync(tgz).slice(0, 700);
		await rejectsAsync(untar(Bun.gzipSync(tar)), "truncated");
	});
});

describe("plugin rules", () => {
	it.each(["package.json", "fluxify.json"])("needs %s", (name) =>
		rejects(() => validatePlugin(files({ [name]: null })), `no ${name}`),
	);
	it("needs no bun.lock without runtime dependencies", () =>
		expect(validatePlugin(files({ "bun.lock": null })).version).toBe(VERSION));

	const LOCK = '{ "lockfileVersion": 1, "packages": { "ms": ["ms@2.1.3", "", {}, "sha512-x"], }, }';
	const withMs = (lock: string | null) =>
		files({ "package.json": packageWith({ ms: "2.1.3" }), "bun.lock": lock });
	it("takes a bun.lock that pins every runtime dependency", () =>
		expect(validatePlugin(withMs(LOCK)).version).toBe(VERSION));
	it.each([
		[null, "bun.lock is missing or empty"],
		["", "bun.lock is missing or empty"],
		["{ not json", "bun.lock does not parse"],
		['{ "packages": {} }', "bun.lock has no lockfileVersion"],
		['{ "lockfileVersion": 1, "packages": {} }', "bun.lock does not pin ms"],
	])("refuses runtime dependencies with the bun.lock %p", (lock, message) =>
		rejects(() => validatePlugin(withMs(lock)), message),
	);
	it.each(["@fluxify/sdk", "zod"])("refuses %s in dependencies: the worker provides it", (name) =>
		rejects(
			() => validatePlugin(files({ "package.json": packageWith({ [name]: "^4.0.0" }) })),
			`${name} is in "dependencies": move it to "peerDependencies"`,
		));
	it("refuses an SDK range this Fluxify does not provide", () =>
		rejects(
			() =>
				validatePlugin(
					files({
						"fluxify.json": JSON.stringify({ ...manifest(NAME, [entry(`${NAME}/step`)]), sdk: ">=9999.1.1" }),
					}),
				),
			"needs @fluxify/sdk >=9999.1.1, but this Fluxify provides",
		));
	it("refuses node_modules", () =>
		rejects(() => validatePlugin(files({ "node_modules/x/index.js": "1" })), "node_modules"));
	it("refuses a fluxify.json the SDK schema rejects", () =>
		rejects(
			() => validatePlugin(files({ "fluxify.json": JSON.stringify({ name: NAME }) })),
			"Invalid fluxify.json",
		));
	it("refuses an entry that is not in dist/", () =>
		rejects(
			() => validatePlugin(files({ "dist/blocks/step.js": null })),
			"not in the plugin's dist/",
		));
	it("refuses a package.json name that differs from fluxify.json", () =>
		rejects(
			() =>
				validatePlugin(
					files({
						"package.json": JSON.stringify({
							version: VERSION,
							fluxify: { name: "acme/other", url: "https://x.dev" },
						}),
					}),
				),
			"acme/other",
		));
	it("refuses a version that is not exact", () =>
		rejects(
			() =>
				validatePlugin(
					files({ "package.json": JSON.stringify({ version: "^1.0.0", fluxify: { name: NAME } }) }),
				),
			"exact version",
		));

	const withIcon = (icon: string, pack: Over = {}) =>
		files({
			"fluxify.json": JSON.stringify(manifest(NAME, [entry(`${NAME}/step`, { icon })])),
			...pack,
		});
	it("refuses an icon that is not in the plugin", () =>
		rejects(() => validatePlugin(withIcon("icons/x.svg")), "is not in the plugin"));
	it("refuses an icon outside the plugin", () =>
		rejects(
			() => validatePlugin(withIcon("../x.svg", { "../x.svg": "<svg/>" })),
			"is not in the plugin",
		));
	it("refuses an icon over the custom block limit", () =>
		rejects(
			() => validatePlugin(withIcon("icons/x.svg", { "icons/x.svg": "a".repeat(ICON_URL_MAX) })),
			"the limit is",
		));
	const iconOf = (v: ReturnType<typeof validatePlugin>) =>
		Object.values(v.manifest.blocks)[0].icon;
	it("turns an icon path into a data URL of the file's type", () => {
		const svg = iconOf(validatePlugin(withIcon("icons/x.svg", { "icons/x.svg": "<svg/>" })));
		expect(svg).toBe(`data:image/svg+xml;base64,${btoa("<svg/>")}`);
		const png = iconOf(validatePlugin(withIcon("./icons/x.PNG", { "icons/x.PNG": "png" })));
		expect(png).toBe(`data:image/png;base64,${btoa("png")}`);
	});
	it("passes a data URL through after the size check", () => {
		const url = `data:image/png;base64,${btoa("png")}`;
		expect(iconOf(validatePlugin(withIcon(url)))).toBe(url);
		rejects(() => validatePlugin(withIcon(`data:image/png;base64,${"a".repeat(ICON_URL_MAX)}`)), "the limit is");
	});
});
