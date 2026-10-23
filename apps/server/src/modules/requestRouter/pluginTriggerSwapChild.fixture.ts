import type { TriggerArtifact } from "../compiler/artifacts";
import { applyPluginTrigger, shutdownPluginTriggers } from "../triggers/pluginTriggerRuntime";
import { type PluginTriggerRef, setPluginTriggerRefs } from "./pluginTriggers";

// A stand-in execution process: starts the plugin trigger its bootstrap refs
// name, from an artifact published for that version, and answers every request
// with the version its running instance reports. On SIGTERM it shuts the
// triggers down, as the real one does.
let server: ReturnType<typeof Bun.serve> | undefined;

process.on("message", async (message: any) => {
	if (message.type === "plugin-refs") return setPluginTriggerRefs(message.triggers);
	if (message.type !== "bootstrap") return;
	const refs: PluginTriggerRef[] = message.bootstrap.pluginTriggers ?? [];
	setPluginTriggerRefs(refs);
	const ref = refs[0]!;
	await applyPluginTrigger("t1", {
		triggerId: "t1",
		projectId: ref.projectId,
		workflowId: "wf",
		groupId: "default",
		type: `plugin:${ref.kind}`,
		integrationId: null,
		batchSize: 1,
		maxWaitMs: 0,
		maxBytes: 1024,
		concurrency: 1,
		source: {},
		plugin: {
			kind: ref.kind,
			name: ref.plugin,
			version: ref.version,
			integrity: ref.integrity,
			retry: false,
		},
		publishedAt: new Date().toISOString(),
	} satisfies TriggerArtifact);
	server = Bun.serve({
		port: message.bootstrap.port,
		reusePort: true,
		fetch: () => new Response(String((globalThis as { tickVersion?: string }).tickVersion)),
	});
	process.send?.({ type: "ready" });
});

process.on("SIGTERM", async () => {
	await server?.stop();
	await shutdownPluginTriggers();
	process.exit(0);
});
