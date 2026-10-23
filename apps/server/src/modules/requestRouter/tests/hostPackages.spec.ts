import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "fluxify-host-packages-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (path: string, text: string) => {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
};

it("a plugin's @fluxify/sdk, zod and ai are the bundled worker's own, with no node_modules and a stray copy ignored", async () => {
	// the image's layout: bundles, a bunfig that disables auto-install, no node_modules
	const built = await Bun.build({
		entrypoints: [join(import.meta.dir, "hostPackages.fixture.ts")],
		outdir: join(root, "worker"),
		target: "bun",
	});
	expect(built.success).toBe(true);
	write("bunfig.toml", '[install]\nauto = "disable"\n');
	// a plugin under the deps root, which installed its own zod anyway
	write(
		"deps/p1/plugins/acme/echo/1.0.0/dist/blocks/step.js",
		`import { block, param } from "@fluxify/sdk/blocks";
import { z } from "zod";
import { generateText } from "ai";
export { block, z, generateText };
export default block({ name: "acme/echo/step", label: "Step", params: { who: param.string({ label: "Who" }) }, run: () => ({ output: z.string().parse("ok") }) });`,
	);
	write("deps/p1/plugins/acme/echo/1.0.0/node_modules/zod/package.json", '{"name":"zod","type":"module","main":"index.js"}');
	write("deps/p1/plugins/acme/echo/1.0.0/node_modules/zod/index.js", 'export const z = "stray";');
	write("deps/p1/plugins/acme/echo/1.0.0/node_modules/ai/package.json", '{"name":"ai","type":"module","main":"index.js"}');
	write("deps/p1/plugins/acme/echo/1.0.0/node_modules/ai/index.js", 'export const generateText = "stray";');

	const child = Bun.spawn(
		[process.execPath, join(root, "worker", "hostPackages.fixture.js"), join(root, "deps/p1/plugins/acme/echo/1.0.0/dist/blocks/step.js")],
		{ cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_PATH: "" } },
	);
	const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(err).toBe("");
	expect(code).toBe(0);
	expect(JSON.parse(out)).toEqual({ block: true, z: true, ai: true, out: "acme/echo/step" });
}, 60_000);
