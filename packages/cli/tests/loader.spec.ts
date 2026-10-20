// The tarball `blocks build` makes, unpacked where a worker puts a plugin, is
// loaded by the real plugin loader and its block runs in a compiled graph.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { type BlockDTOType, BlockTypes, compileGraph } from "@fluxify/blocks";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { pluginDir } from "@fluxify/server/src/modules/packages/depsDir";
import {
	loadPluginBlocks,
	setPluginRefs,
} from "@fluxify/server/src/modules/requestRouter/pluginLoader";
import { build } from "../src/build";
import { create } from "../src/create";
import { init } from "../src/init";
import { cleanup, LOCK, linkModules, tmp } from "./helpers";

afterAll(cleanup);

const P = "proj-cli-plugin";
const TYPE = "acme/slack/post";

const block = (id: string, type: string, data: Record<string, unknown> = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-source`,
});

describe("a built plugin on a worker", () => {
	it("init, blocks create and build make a tarball the loader runs", async () => {
		// the author's machine
		const { root } = await init({
			cwd: tmp(),
			name: "acme/slack",
			url: "https://example.com/slack",
			install: false,
		});
		await Bun.write(join(root, "bun.lock"), LOCK);
		linkModules(root);
		await create({ cwd: root, name: "post" });
		const { tarball, warnings } = await build(root);
		expect(warnings).toEqual([]);

		// a worker: <deps>/<project>/plugins/<scope>/<name>/<version>/
		const deps = tmp("fx-deps-");
		const dir = pluginDir(P, "acme/slack", "0.1.0", deps);
		const staging = tmp("fx-unpack-");
		await new Bun.Archive(await Bun.file(join(root, tarball)).bytes()).extract(staging);
		mkdirSync(dirname(dir), { recursive: true });
		renameSync(join(staging, "package"), dir);
		linkModules(dir); // what `bun install --frozen-lockfile` provides

		const manifest = fluxifyManifestSchema.parse(await Bun.file(join(dir, "fluxify.json")).json());
		const entry = manifest.blocks[TYPE];
		setPluginRefs([
			{
				projectId: P,
				type: TYPE,
				plugin: manifest.name,
				version: "0.1.0",
				entry: join(dir, entry.entry),
				meta: {
					handles: entry.handles,
					invoke: entry.invoke,
					schemaParams: Object.keys(entry.params).filter((k) => entry.params[k].type === "schema"),
				},
			},
		]);
		await loadPluginBlocks(P, [TYPE]);

		const graph = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("post", TYPE, { who: "ada" }),
				block("ok", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("entry", "post"), edge("post", "ok")],
			{
				projectId: P,
				blockMeta: {
					[TYPE]: {
						handles: entry.handles,
						invoke: entry.invoke,
						schemaParams: [],
					},
				},
			},
		);
		expect(graph.pluginBlocks).toEqual([TYPE]);
		const ctx = {
			route: "/post",
			apiId: "api-1",
			projectId: P,
			vars: {},
			stopper: { timeoutEnd: 0, duration: 10_000 },
		} as never;
		const { output } = await graph.run(ctx, {});
		expect(output.body).toBe("Hello, ada!");
	}, 60_000);
});
