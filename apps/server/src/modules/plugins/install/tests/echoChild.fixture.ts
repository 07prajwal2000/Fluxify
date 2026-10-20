import { getBlockEntry } from "@fluxify/blocks";
import {
	loadPluginBlocks,
	type PluginBlockRef,
	setPluginRefs,
} from "../../../requestRouter/pluginLoader";

// A stand-in execution process: it loads the first plugin block its refs name
// when asked, and answers every request with that block's output and its own
// pid, so a test can tell which process served and how many there were.
let server: ReturnType<typeof Bun.serve> | undefined;
let refs: PluginBlockRef[] = [];

process.on("message", (message: any) => {
	if (message.type === "plugin-refs") {
		refs = message.refs;
		return setPluginRefs(refs);
	}
	if (message.type !== "bootstrap") return;
	refs = message.bootstrap.pluginRefs ?? [];
	setPluginRefs(refs);
	server = Bun.serve({
		port: message.bootstrap.port,
		reusePort: true,
		fetch: async () => {
			const ref = refs[0];
			if (!ref) return new Response(`none|${process.pid}`);
			try {
				await loadPluginBlocks(ref.projectId, [ref.type]);
				const entry = getBlockEntry(ref.projectId, ref.type)!;
				const result = await entry.run({ projectId: ref.projectId } as never, { params: {} } as never);
				return new Response(`${result.output}|${process.pid}`);
			} catch (error) {
				return new Response(`error: ${(error as Error).message}|${process.pid}`);
			}
		},
	});
	process.send?.({ type: "ready" });
});

process.on("SIGTERM", async () => {
	await server?.stop();
	process.exit(0);
});
