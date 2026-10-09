import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { type Part, printRun } from "./progress";

afterEach(() => setSystemTime());

/** A run whose stream the test drives; `wait(s)` moves the clock. */
async function drive(steps: (Part | number)[]) {
	setSystemTime(new Date("2026-01-01T00:00:00Z"));
	let shown = "";
	const result = {
		compactions: [],
		whenCompacting: () => {},
		stopped: () => undefined,
		stream: (async function* () {
			for (const s of steps) {
				if (typeof s === "number") setSystemTime(new Date(Date.now() + s * 1000));
				else yield s;
			}
		})(),
	};
	await printRun(result as never, { write: (s) => (shown += s), tty: true });
	// eslint-disable-next-line no-control-regex
	return shown.replace(/\x1b\[[0-9;]*[A-Za-z]|\r/g, "");
}

const call = { type: "tool-call", toolCallId: "t1", toolName: "get_route", input: {} } as Part;
const result = {
	type: "tool-result",
	toolCallId: "t1",
	toolName: "get_route",
	input: {},
	output: "ok",
} as Part;

describe("thinking timer in the terminal", () => {
	it("shows the model call and the turn total: the second think restarts at 0", async () => {
		const out = await drive([
			{ type: "reasoning-start", id: "r" } as Part,
			40,
			{ type: "reasoning-end", id: "r" } as Part,
			call,
			230,
			result,
			{ type: "reasoning-start", id: "r2" } as Part,
		]);
		// the first call is the whole turn: no total next to it
		expect(out).toStartWith("waiting for model… 0sthinking… 0swaiting for model… 0s (turn 40s)");
		expect(out).not.toContain("(turn 0s)");
		// after 270s of tools and thinking, the next call starts at 0s inside a 270s turn
		expect(out).toContain("waiting for model… 0s (turn 270s)");
		expect(out).toContain("thinking… 0s (turn 270s)");
	});
});
