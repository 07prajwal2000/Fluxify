import { afterAll } from "bun:test";
import { stopEngines } from "./engines";
import { stopWorkflows } from "./workflow";

/**
 * Preloaded into every test file, so the containers the suite shares are torn
 * down exactly once, after the last file finishes. Nothing starts them here — a
 * database or a broker no fixture asks for is never launched.
 */
afterAll(async () => {
	// the broker first: its connection has to drain before the socket goes away
	await stopWorkflows();
	await stopEngines();
});
