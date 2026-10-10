import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
const results = Array.from({ length: 12 }, (_, i) => ({
	type: "route",
	id: `r${i}`,
	name: `Route ${i}`,
	label: `Route ${i}`,
}));
mock.module("@/query/resourceSearchQuery", () => ({
	useResourceSearch: () => ({ results, isLoading: false, isFetching: false }),
}));

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { MentionPopover } = await import("./MentionPopover");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("the arrow keys scroll the highlighted row into view", () => {
	const scrolled: string[] = [];
	Element.prototype.scrollIntoView = function (this: Element) {
		scrolled.push(this.textContent ?? "");
	};
	const view = render(<MentionPopover projectId="p1" wasAtTyped={false} onClose={() => {}} />);
	const input = view.getByPlaceholderText("Search resources...");
	fireEvent.keyDown(input, { key: "ArrowDown" });
	fireEvent.keyDown(input, { key: "ArrowDown" });
	expect(scrolled.at(-1)).toContain("Route 2");
	expect(view.container.querySelector('[aria-current="true"]')?.textContent).toContain("Route 2");
});
