// Stands in for the worker's supervisor: spawns the worker image's own execution process
// and bootstraps it over IPC with the artifacts from dist/artifacts.json. The child serves
// HTTP itself, as it does in a real worker; no NATS, no admin, no database for config.
// Run inside fluxify-worker:local:  bun /h/harness.ts
const ENTRY = process.env.EXECUTION_ENTRY ?? "/app/worker/executionProcess.js";
const artifacts = await Bun.file(process.env.ARTIFACTS ?? "/h/dist/artifacts.json").json();
const projectId = artifacts[0].key.split(".")[1];

const childArgs = process.env.CHILD_ARGS ? process.env.CHILD_ARGS.split(" ") : [];
const child = Bun.spawn([process.execPath, ...childArgs, ENTRY], {
	cwd: "/app",
	stdout: "inherit",
	stderr: "inherit",
	ipc(message) {
		if (message.type === "ready") console.log("[harness] execution process ready");
	},
});

child.send({
	type: "bootstrap",
	bootstrap: {
		projectId,
		port: Number(process.env.WORKER_PORT ?? 5600),
		databaseIdleTimeoutMs: 450_000,
		asyncExecutor: { maxInFlight: 10, maxQueueDepth: 100, drainTimeoutMs: 30_000 },
		baseDomain: "",
		trustedOrigins: [],
		artifacts,
		pluginRefs: [],
		pluginIntegrations: [],
		workerTimeoutsEnabled: false,
		env: "production",
		maxRequestBodyBytes: 10 * 1024 * 1024,
		scheduleHorizonMs: 30 * 24 * 3600 * 1000,
		logging: { level: "info", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
	},
});

process.on("SIGTERM", () => child.kill());
await child.exited;
