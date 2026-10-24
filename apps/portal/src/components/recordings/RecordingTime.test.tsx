import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, render } = await import("@testing-library/react");
const { RecordingTime } = await import("./RecordingTime");
const { formatAbsoluteTime } = await import("./time");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

describe("RecordingTime", () => {
	test("renders dash when timestamp is missing or invalid", () => {
		const { container } = render(<RecordingTime timestamp={null} />);
		expect(container.textContent).toBe("—");

		const { container: invalid } = render(<RecordingTime timestamp="not-a-date" />);
		expect(invalid.textContent).toBe("—");
	});

	test("renders relative time for recent recording", () => {
		const fiveSecondsAgo = new Date(Date.now() - 5_000).toISOString();
		const { container } = render(<RecordingTime timestamp={fiveSecondsAgo} />);
		expect(container.textContent).toBe("5s ago");
	});

	test("renders relative time for older recording", () => {
		const thirtyFiveMinAgo = new Date(Date.now() - 35 * 60_000).toISOString();
		const { container } = render(<RecordingTime timestamp={thirtyFiveMinAgo} />);
		expect(container.textContent).toBe("35m ago");
	});

	test("formats absolute time matching local timezone on hover tooltip", () => {
		const date = new Date(2026, 9, 23, 14, 32, 8);
		const expectedAbsolute = formatAbsoluteTime(date);
		expect(expectedAbsolute).toBe("23 Oct 2026, 14:32:08");

		const { container } = render(<RecordingTime timestamp={date.toISOString()} />);
		expect(container.textContent).toBeDefined();
	});

	test("refreshes relative label over time without going stale", async () => {
		const start = Date.now();
		const recordedAt = new Date(start - 2_100).toISOString();
		const { container } = render(<RecordingTime timestamp={recordedAt} />);
		expect(container.textContent).toBe("2s ago");

		await act(async () => {
			await new Promise((r) => setTimeout(r, 1200));
		});
		expect(container.textContent).not.toBe("2s ago");
	});
});
