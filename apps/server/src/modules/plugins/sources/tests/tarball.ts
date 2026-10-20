import { gzipSync } from "node:zlib";
import { entry, manifest } from "../../tests/fixtures";

/** one tar entry; `type` is the ustar typeflag ('0' file, '5' folder, '2' symlink, ...) */
export type TarEntry = { name: string; data?: string | Uint8Array; type?: string; link?: string };

const enc = new TextEncoder();

function header({ name, data = "", type = "0", link = "" }: TarEntry) {
	const block = new Uint8Array(512);
	const put = (text: string, at: number) => block.set(enc.encode(text), at);
	const size = typeof data === "string" ? enc.encode(data).length : data.length;
	put(name, 0);
	put("0000644\0", 100);
	put("0000000\0", 108);
	put("0000000\0", 116);
	put(`${size.toString(8).padStart(11, "0")}\0`, 124);
	put("00000000000\0", 136);
	put("        ", 148);
	put(type, 156);
	put(link, 157);
	put("ustar\0", 257);
	put("00", 263);
	const sum = block.reduce((a, b) => a + b, 0);
	put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
	return block;
}

/** A gzipped tar of exactly these entries, written by hand so a test can craft one `bun pm pack` never would. */
export function rawTgz(entries: TarEntry[]) {
	const parts: Uint8Array[] = [];
	for (const e of entries) {
		const bytes = typeof e.data === "string" ? enc.encode(e.data) : (e.data ?? new Uint8Array());
		parts.push(header(e), bytes, new Uint8Array((512 - (bytes.length % 512)) % 512));
	}
	parts.push(new Uint8Array(1024));
	return new Uint8Array(gzipSync(Buffer.concat(parts)));
}

export const NAME = "acme/echo";
export const VERSION = "2026.10.2001";
const ENTRY = "dist/blocks/step.js";

type Overrides = Record<string, string | Uint8Array | null>;

/** a valid plugin's package.json with these runtime `dependencies` */
export const packageWith = (dependencies: Record<string, string>) =>
	JSON.stringify({
		name: "@acme/echo",
		version: VERSION,
		fluxify: { name: NAME, url: "https://github.com/acme/fluxify-echo" },
		dependencies,
	});

/** the files of a valid plugin; `over` replaces, adds or (with null) removes one */
export function pluginFiles(over: Overrides = {}) {
	const files: Overrides = {
		"package.json": JSON.stringify({
			name: "@acme/echo",
			version: VERSION,
			fluxify: { name: NAME, url: "https://github.com/acme/fluxify-echo" },
		}),
		"bun.lock": "{}",
		"fluxify.json": JSON.stringify(manifest(NAME, [entry(`${NAME}/step`)])),
		[ENTRY]: "export default {};",
		...over,
	};
	return Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)) as Record<
		string,
		string | Uint8Array
	>;
}

/** a valid plugin tarball under `package/`, as npm and `bun pm pack` lay it out */
export const pluginTgz = (over: Overrides = {}) =>
	rawTgz(Object.entries(pluginFiles(over)).map(([name, data]) => ({ name: `package/${name}`, data })));
