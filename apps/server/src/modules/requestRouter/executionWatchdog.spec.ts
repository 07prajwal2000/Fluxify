import { expect, test } from "bun:test";
import { ExecutionWatchdog } from "./executionWatchdog";

test("does not retain execution state while disabled", () => {
	const watchdog = new ExecutionWatchdog(() => 10_000);
	watchdog.start({ requestId: "a", routeId: "route-a", timeoutMs: 30_000 });
	expect(watchdog.findTimedOut()).toBeUndefined();
});

test("permits an async route to outlive its timeout when it keeps heartbeating", () => {
	let now = 0;
	const watchdog = new ExecutionWatchdog(() => now, 1_000);
	watchdog.setEnabled(true);
	watchdog.start({ requestId: "a", routeId: "route-a", timeoutMs: 30_000 });

	now = 60_000;
	watchdog.heartbeat();
	expect(watchdog.findTimedOut()).toBeUndefined();
});

test("selects only a deadline-exceeded execution after its heartbeat stalls", () => {
	let now = 0;
	const watchdog = new ExecutionWatchdog(() => now, 1_000);
	watchdog.setEnabled(true);
	watchdog.start({ requestId: "a", routeId: "route-a", timeoutMs: 30_000 });

	now = 29_999;
	expect(watchdog.findTimedOut()).toBeUndefined();
	now = 30_000;
	expect(watchdog.findTimedOut()).toEqual({
		requestId: "a",
		routeId: "route-a",
		timeoutMs: 30_000,
		stalledForMs: 30_000,
	});
});

test("drops finished executions before evaluating a stalled heartbeat", () => {
	let now = 0;
	const watchdog = new ExecutionWatchdog(() => now, 1_000);
	watchdog.setEnabled(true);
	watchdog.start({ requestId: "a", routeId: "route-a", timeoutMs: 30_000 });
	watchdog.finish("a");
	now = 60_000;
	expect(watchdog.findTimedOut()).toBeUndefined();
});
