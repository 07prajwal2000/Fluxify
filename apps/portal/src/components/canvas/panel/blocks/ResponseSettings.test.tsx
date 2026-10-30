import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { BlockNode } from "../../types";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
// a real provider: the change tracker's default keeps fields readonly, which this checks
const { ReactFlowProvider } = await import("@xyflow/react");
const { responseSettings } = await import("./ResponseSettings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const block = (data: Record<string, unknown>) =>
	({ id: "response-1", type: "response", position: { x: 0, y: 0 }, data }) as BlockNode;

// a TabHead renders nothing itself; the panel lays its children out
const renderPanel = (data: Record<string, unknown>) =>
	render(
		<ReactFlowProvider>
			{responseSettings(block(data)).map((tab) => (
				<div key={tab.key}>{(tab.props as { children: ReactNode }).children}</div>
			))}
		</ReactFlowProvider>,
	);

test("Hold connection is always shown, with the sse.connect hint", () => {
	const view = renderPanel({ httpCode: "200" });
	const box = view.getByRole("checkbox", { name: /Hold connection/ }) as HTMLInputElement;
	expect(box.checked).toBe(false);
	expect(view.getByText(/Only applies after sse.connect in this request/)).toBeTruthy();
});

test("Hold connection reflects the saved value and is readonly outside edit mode", () => {
	const view = renderPanel({ httpCode: "200", holdConnection: true });
	const box = view.getByRole("checkbox", { name: /Hold connection/ }) as HTMLInputElement;
	expect(box.checked).toBe(true);
	expect(box.disabled).toBe(true);
});
