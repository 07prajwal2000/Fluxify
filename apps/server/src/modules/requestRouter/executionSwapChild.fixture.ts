export {};

// A stand-in execution process: serves its pid on the bootstrap port, reports
// ready, drains on SIGTERM. A bootstrap for project "crash" dies before ready.
let server: ReturnType<typeof Bun.serve> | undefined;

process.on("message", (message: any) => {
	if (message.type !== "bootstrap") return;
	if (message.bootstrap.projectId === "crash") process.exit(1);
	server = Bun.serve({
		port: message.bootstrap.port,
		reusePort: true,
		fetch: () => new Response(String(process.pid)),
	});
	process.send?.({ type: "ready" });
});

process.on("SIGTERM", async () => {
	await server?.stop();
	process.exit(0);
});
