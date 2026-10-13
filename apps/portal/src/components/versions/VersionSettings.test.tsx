import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { middlewaresService } = await import("@/services/middlewares");

// Monaco cannot load under `bun test`: `setup.ts` imports Vite's `?worker`
// entries, which only a bundler resolves. Stub the read-only host so these
// assertions are about which surface renders, not about Monaco itself.
mock.module("../../../../../packages/components/src/JavaScriptTextArea/monacoEditor", () => ({
	MonacoEditor: ({ value }: { value?: string }) => (
		<pre className="monaco-editor" data-testid="monaco">
			{value}
		</pre>
	),
}));

const { VersionSettings } = await import("./VersionSettings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
	mock.restore();
	// the route settings sidebar reads the middleware list; nothing here has any
	spyOn(middlewaresService, "getAll").mockResolvedValue([]);
});

function renderSettings(settings: Record<string, unknown>) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<VersionSettings kind="route" projectId="p1" settings={settings} />
		</QueryClientProvider>,
	);
}

async function until<T>(check: () => T, timeout = 3000): Promise<T> {
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

// #791: the read-only panel used to render the whole Schema editor builder.
test("a builder schema shows the read-only summary, not the builder", () => {
	const view = renderSettings({
		method: "post",
		path: "/users",
		bodySchema: {
			dataType: "object",
			properties: [
				{ key: "email", dataType: "str", required: true, rules: [{ type: "minLength", value: 3 }] },
			],
		},
	});

	// the summary: property name, type and rules
	const panel = view.getByLabelText("Version settings");
	expect(panel.textContent).toContain("email");
	expect(panel.textContent).toContain("str");
	expect(panel.textContent).toContain("minLength: 3");
	// not the builder: no tabs, no root type selector, nothing to type into
	expect(view.queryByText("Schema editor")).toBeNull();
	expect(view.queryAllByRole("tab")).toHaveLength(0);
	expect(view.queryByRole("combobox")).toBeNull();
	expect(panel.querySelector("input, textarea")).toBeNull();
});

test("a custom JS schema shows its validator read-only", async () => {
	const view = renderSettings({
		bodySchema: { dataType: "js", js: "return typeof body.email === 'string';" },
	});

	const code = await until(() => view.getByTestId("monaco"));
	expect(code.textContent).toContain("typeof body.email === 'string'");
	expect(view.queryByText("Schema editor")).toBeNull();
});

test("a custom JS schema with no code says so", () => {
	const view = renderSettings({ bodySchema: { dataType: "js" } });
	expect(view.getByText("No code defined yet.")).toBeTruthy();
});
