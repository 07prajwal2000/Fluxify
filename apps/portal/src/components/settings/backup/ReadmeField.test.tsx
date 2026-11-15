import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { useState } = await import("react");
const { ReadmeField, README_MAX_BYTES } = await import("./ReadmeField");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

async function until<T>(check: () => T, timeout = 1500): Promise<T> {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (e) {
			if (Date.now() > end) throw e;
			await act(() => new Promise((r) => setTimeout(r, 20)));
		}
	}
}

function Harness({ initial = "", highlight = false }: { initial?: string; highlight?: boolean }) {
	const [value, setValue] = useState(initial);
	return <ReadmeField value={value} onChange={setValue} highlight={highlight} />;
}

const tab = (name: string) =>
	[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes(name))!;
const box = () => document.querySelector("textarea") as HTMLTextAreaElement;

test("Write is the first tab, Preview renders what was typed as Markdown", async () => {
	render(<Harness />);
	expect(tab("Write").getAttribute("aria-selected")).toBe("true");

	fireEvent.change(box(), { target: { value: "# Set me up\n\nUse **node 24**." } });
	expect(box().value).toBe("# Set me up\n\nUse **node 24**.");

	fireEvent.click(tab("Preview"));
	await until(() => expect(document.querySelector("h1")?.textContent).toBe("Set me up"));
	expect(document.querySelector("strong")?.textContent).toBe("node 24");
	expect(tab("Preview").getAttribute("aria-selected")).toBe("true");

	// the text is still there when going back to Write
	fireEvent.click(tab("Write"));
	await until(() => expect(box().value).toContain("Use **node 24**."));
});

test("an empty README previews as nothing, and says secrets don't belong in it", async () => {
	render(<Harness />);
	fireEvent.click(tab("Preview"));
	await until(() => expect(document.body.textContent).toContain("Nothing to preview yet."));
	expect(document.body.textContent).toContain("Stored unencrypted. Don't put secrets here.");
});

test("a template's README is highlighted and says who reads it", () => {
	const plain = render(<Harness />);
	const section = () => document.querySelector('section[aria-label="README"]')!;
	expect(section().className).not.toContain("border-accent");
	expect(section().textContent).toContain("restores this backup");
	plain.unmount();

	render(<Harness highlight />);
	expect(section().className).toContain("border-accent");
	expect(section().textContent).toContain("creates a project from this template");
});

test("warns when the text is over the 64 KB limit, counted in bytes", () => {
	render(<Harness initial={"é".repeat(README_MAX_BYTES / 2 + 1)} />);
	const note = [...document.querySelectorAll("p")].find((p) =>
		p.textContent?.includes("Stored unencrypted"),
	)!;
	expect(note.textContent).toContain("the limit is 64 KB");
	expect(note.className).toContain("text-danger");
});
