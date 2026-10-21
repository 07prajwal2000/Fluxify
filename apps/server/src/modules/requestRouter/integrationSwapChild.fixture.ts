import { integrationRegistry } from "@fluxify/adapters/integrations";
import { openVariant } from "@fluxify/sdk/runtime";
import { loadPluginIntegrations } from "./pluginIntegrations";

// A stand-in execution process: registers the plugin integrations its bootstrap
// names before ready, and answers each request with the version of the client
// it opens. `/slow` holds its client open for a while, an in-flight request.
let server: ReturnType<typeof Bun.serve> | undefined;

process.on("message", async (message: any) => {
	if (message.type === "plugin-refs") return void loadPluginIntegrations(message.integrations);
	if (message.type !== "bootstrap") return;
	await loadPluginIntegrations(message.bootstrap.pluginIntegrations);
	server = Bun.serve({
		port: message.bootstrap.port,
		reusePort: true,
		fetch: async (request) => {
			const def = integrationRegistry.require("acme/crm", "Hub", "p1");
			const { client, close } = await openVariant(def, def.resolve!({}, {}));
			if (new URL(request.url).pathname === "/slow") await Bun.sleep(1_500);
			await close();
			return new Response(String((client as { version: string }).version));
		},
	});
	process.send?.({ type: "ready" });
});

process.on("SIGTERM", async () => {
	await server?.stop();
	process.exit(0);
});
