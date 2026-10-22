import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { CACHE_COLD_AFTER_MS } = await import("./cacheIdle");
const { ColdCacheHint } = await import("./ColdCacheHint");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("hidden while the chat is fresh", () => {
	const view = render(<ColdCacheHint lastCallAt={Date.now() - 60_000} running={false} />);
	expect(view.queryByText("Idle chat")).toBeNull();
});

test("shows when idle and not running, explaining the cost", () => {
	const view = render(
		<ColdCacheHint lastCallAt={Date.now() - CACHE_COLD_AFTER_MS - 1_000} running={false} />,
	);
	const chip = view.getByText("Idle chat");
	expect(chip.closest("[aria-label]")?.getAttribute("aria-label")).toBe(
		"This chat has been idle. The next message re-reads the history at full cost and may be slower.",
	);
});

test("hidden while a run is going, and with nothing to date", () => {
	const old = Date.now() - CACHE_COLD_AFTER_MS * 2;
	expect(render(<ColdCacheHint lastCallAt={old} running />).queryByText("Idle chat")).toBeNull();
	cleanup();
	expect(
		render(<ColdCacheHint lastCallAt={null} running={false} />).queryByText("Idle chat"),
	).toBeNull();
});
