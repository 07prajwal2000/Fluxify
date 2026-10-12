import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { useState } = await import("react");
const { EnvPicker } = await import("./EnvPicker");

type RunEnv = "development" | "production";

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

function Harness({
	initial = "development",
	...rest
}: { initial?: RunEnv } & Partial<Parameters<typeof EnvPicker>[0]>) {
	const [env, setEnv] = useState<RunEnv>(initial);
	return <EnvPicker env={env} onEnvChange={setEnv} {...rest} />;
}

const box = (view: ReturnType<typeof render>) =>
	view.getByRole("checkbox", { name: /Production/ }) as HTMLInputElement;

test("development is the default, and production is offered", () => {
	const view = render(<Harness />);
	expect(box(view).checked).toBe(false);
	expect(box(view).disabled).toBe(false);
});

test("production is disabled with the reason when nothing is promoted", () => {
	const view = render(<Harness productionDisabled />);
	expect(box(view).disabled).toBe(true);
	expect(view.getByText("Not promoted yet")).toBeTruthy();
});

test("picking production asks a confirm, then selects it", async () => {
	const view = render(<Harness confirm="Production data is never touched." />);
	await act(async () => {
		fireEvent.click(box(view));
	});
	await until(() => view.getByText("Production data is never touched."));

	const proceed = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Continue",
	)!;
	await act(async () => {
		fireEvent.click(proceed);
	});
	await until(() => expect(box(view).checked).toBe(true));
});

test("turning it back off returns to development without a confirm", async () => {
	const view = render(<Harness initial="production" />);
	expect(box(view).checked).toBe(true);
	await act(async () => {
		fireEvent.click(box(view));
	});
	await until(() => expect(box(view).checked).toBe(false));
	expect(document.body.textContent).not.toContain("Production data is never touched.");
});

async function clickContinue() {
	const proceed = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Continue",
	)!;
	await act(async () => {
		fireEvent.click(proceed);
	});
}

test("by default every switch to production asks again", async () => {
	const view = render(<Harness confirm="Production data is never touched." />);
	await act(async () => {
		fireEvent.click(box(view));
	});
	await until(() => view.getByText("Production data is never touched."));
	await clickContinue();
	await until(() => expect(box(view).checked).toBe(true));

	// back to development, then to production again: it asks a second time
	await act(async () => {
		fireEvent.click(box(view));
	});
	await until(() => expect(box(view).checked).toBe(false));
	await act(async () => {
		fireEvent.click(box(view));
	});
	await until(() => view.getByText("Production data is never touched."));
});

test("confirmOnce asks only the first time in a mount", async () => {
	const view = render(<Harness confirm="Production data is never touched." confirmOnce />);
	await act(async () => {
		fireEvent.click(box(view));
	});
	await until(() => view.getByText("Production data is never touched."));
	await clickContinue();
	await until(() => expect(box(view).checked).toBe(true));

	await act(async () => {
		fireEvent.click(box(view));
	});
	await until(() => expect(box(view).checked).toBe(false));
	await act(async () => {
		fireEvent.click(box(view));
	});
	// no second dialog: it goes straight to production
	await until(() => expect(box(view).checked).toBe(true));
	await act(() => new Promise((r) => setTimeout(r, 30)));
	expect(document.body.textContent).not.toContain("Production data is never touched.");
});
