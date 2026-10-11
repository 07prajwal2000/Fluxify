import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { RecordingIndicator } = await import("./RecordingControls");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const dots = (container: HTMLElement) => container.querySelectorAll(".animate-pulse");

test("nothing shows while no environment records", () => {
	const { container } = render(<RecordingIndicator dev={false} prod={false} />);
	expect(container.textContent).toBe("");
});

test("development alone says so, with one dot", () => {
	const { container } = render(<RecordingIndicator dev prod={false} />);
	expect(container.textContent).toContain("Development recording");
	expect(dots(container)).toHaveLength(1);
	expect(container.querySelector(".bg-accent")).not.toBeNull();
});

test("production alone says so, with one dot", () => {
	const { container } = render(<RecordingIndicator dev={false} prod />);
	expect(container.textContent).toContain("Production recording");
	expect(dots(container)).toHaveLength(1);
	expect(container.querySelector(".bg-danger")).not.toBeNull();
});

test("both show Recording with a dot per environment", () => {
	const { container } = render(<RecordingIndicator dev prod />);
	expect(container.textContent).toBe("Recording");
	expect(dots(container)).toHaveLength(2);
});

test("compact is the dots alone, with the explanation as its title", () => {
	const { container } = render(<RecordingIndicator compact dev prod />);
	expect(container.textContent).toBe("");
	expect(dots(container)).toHaveLength(2);
	expect(container.querySelector("[title]")?.getAttribute("title")).toContain("Development");
});
