import { afterAll } from "bun:test";
import { stopEngines } from "./engines";
import { stopSchedules } from "./schedule";
import { stopTriggers } from "./trigger";
import { stopWorkflows } from "./workflow";

/**
 * Preloaded into every test file, so the containers the suite shares are torn
 * down exactly once, after the last file finishes. Nothing starts them here — a
 * database or a broker no fixture asks for is never launched.
 */
afterAll(async () => {
	// consumers first, then the broker: its connection has to drain before the
	// socket goes away, and a trigger consumer still pulling would keep it open
	await stopSchedules();
	await stopTriggers();
	await stopWorkflows();
	await stopEngines();
});
