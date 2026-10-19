import { getBlockEntry } from "@fluxify/blocks";
import { loadPluginBlocks, setPluginRefs } from "./pluginLoader";

// A stand-in execution process: loads the plugin block its bootstrap refs name,
// before ready, and answers every request with that block's output.
let server: ReturnType<typeof Bun.serve> | undefined;

process.on("message", async (message: any) => {
	if (message.type === "plugin-refs") return setPluginRefs(message.refs);
	if (message.type !== "bootstrap") return;
	setPluginRefs(message.bootstrap.pluginRefs);
	await loadPluginBlocks("p1", ["acme/echo/say"]);
	server = Bun.serve({
		port: message.bootstrap.port,
		reusePort: true,
		fetch: async () => {
			const result = await getBlockEntry("p1", "acme/echo/say")!.run({ projectId: "p1" } as any, {
				params: {},
			});
			return new Response(String(result.output));
		},
	});
	process.send?.({ type: "ready" });
});

process.on("SIGTERM", async () => {
	await server?.stop();
	process.exit(0);
});
