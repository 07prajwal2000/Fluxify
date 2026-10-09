import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render, within } = await import("@testing-library/react");
const { ChatHeader } = await import("./ChatHeader");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("shows the chat name, with the full name on hover and a cut for a long one", () => {
	const long = "Build the users route with paging and a very long name that does not fit";
	const r = render(<ChatHeader title={long} />);
	const h = within(document.body).getByRole("heading", { name: long });
	expect(h.getAttribute("title")).toBe(long);
	expect(h.className).toContain("truncate");
	r.unmount();
	render(<ChatHeader title={null} />);
	expect(within(document.body).getByText("Untitled session")).toBeTruthy();
});
