export {};

const mode = process.argv[2];

const heartbeat = setInterval(() => process.send?.({ type: "heartbeat" }), 10);
process.send?.({
	type: "execution-started",
	requestId: "test-request",
	routeId: "test-route",
	timeoutMs: 75,
});

if (mode === "async") {
	await Bun.sleep(500);
	clearInterval(heartbeat);
	process.send?.({ type: "execution-finished", requestId: "test-request" });
	process.exit(0);
}

await Bun.sleep(25);
while (true) {
	// Simulates a raw synchronous user-code loop.
}
