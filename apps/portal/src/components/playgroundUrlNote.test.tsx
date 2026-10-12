import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

const { cleanup, render } = await import("@testing-library/react");
const { FieldInfoButton } = await import("@fluxify/components");
const { DEV_URL_NOTE } = await import("./sandboxes/sandboxRequest");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

// The playground now renders its URL note through this button (#740 follow-up):
// the note used to be a line of its own under the preview. Mounting the whole
// playground here is not possible — its panels load Monaco — so the button it
// renders is checked with the same label and note the playground passes it.
test("the URL note sits behind an i button, not on a line of its own", () => {
	const view = render(
		<FieldInfoButton label="Where this call goes" info={{ content: DEV_URL_NOTE }} />,
	);
	expect(view.getByRole("button", { name: "About Where this call goes" })).toBeTruthy();
	// closed, so the sentence is not sitting on the page
	expect(view.container.textContent).not.toContain("Sent to the development worker");
});
