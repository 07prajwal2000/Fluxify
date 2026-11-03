import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}

const { cleanup, fireEvent, render } = await import("@testing-library/react");

// Monaco cannot load under `bun test` (Vite `?worker` entries): a textarea stands in for the editor
mock.module("../../../../../../packages/components/src/JavaScriptTextArea/monacoEditor", () => ({
	MonacoEditor: (p: { value?: string; onChange?: (v: string) => void }) => (
		<textarea
			aria-label="json editor"
			value={p.value}
			onChange={(e) => p.onChange?.(e.target.value)}
		/>
	),
}));
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useState } = await import("react");
const { AiForm } = await import("./AiForm");
const { setPath } = await import("../ConnectorFields");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

let latest: Record<string, unknown> = {};

// holds the config the way the integration page does, so the editor sees its own changes echo back
function Harness({
	initial,
	showBaseUrl,
}: {
	initial: Record<string, unknown>;
	showBaseUrl?: boolean;
}) {
	const [config, setConfig] = useState(initial);
	latest = config;
	return (
		<AiForm
			projectId="p"
			name="gpt"
			onName={() => {}}
			config={config}
			showBaseUrl={showBaseUrl}
			setField={(path, value) => setConfig((c) => setPath(c, path, value))}
		/>
	);
}

function renderForm(initial: Record<string, unknown> = {}, showBaseUrl = false) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<Harness initial={initial} showBaseUrl={showBaseUrl} />
		</QueryClientProvider>,
	);
}

test("shows saved headers", () => {
	const view = renderForm({ headers: { "OpenAI-Organization": "org-1" } });
	expect((view.getByLabelText("Header name") as HTMLInputElement).value).toBe(
		"OpenAI-Organization",
	);
	expect(view.getByDisplayValue("org-1")).toBeTruthy();
});

test("adds a header row and writes it to config.headers", () => {
	const view = renderForm();
	fireEvent.click(view.getByText("Add header"));
	fireEvent.change(view.getByLabelText("Header name"), { target: { value: "X-Route" } });
	fireEvent.change(view.getByPlaceholderText("value"), { target: { value: "cfg:ROUTE" } });
	expect(latest.headers).toEqual({ "X-Route": "cfg:ROUTE" });
});

test("edits a header value", () => {
	const view = renderForm({ headers: { "X-A": "1" } });
	fireEvent.change(view.getByDisplayValue("1"), { target: { value: "2" } });
	expect(latest.headers).toEqual({ "X-A": "2" });
});

test("removes a header row", () => {
	const view = renderForm({ headers: { "X-A": "1", "X-B": "2" } });
	fireEvent.click(view.getAllByLabelText("Remove header")[0]);
	expect(latest.headers).toEqual({ "X-B": "2" });
});

test("the extra request body is offered for OpenAI Compatible only, with its saved fields", () => {
	expect(renderForm().queryByText("Extra request body")).toBeNull();
	cleanup();
	const view = renderForm({ extraBody: { reasoning_effort: "low" } }, true);
	expect(view.getByText("Extra request body")).toBeTruthy();
	expect((view.getByLabelText("json editor") as HTMLTextAreaElement).value).toBe(
		JSON.stringify({ reasoning_effort: "low" }, null, 2),
	);
});

test("typing a valid JSON object writes config.extraBody", () => {
	const view = renderForm({}, true);
	fireEvent.change(view.getByLabelText("json editor"), {
		target: { value: '{ "chat_template_kwargs": { "enable_thinking": true } }' },
	});
	expect(latest.extraBody).toEqual({ chat_template_kwargs: { enable_thinking: true } });
});

test("half-typed or non-object JSON shows an error and keeps the last valid body", () => {
	const view = renderForm({ extraBody: { a: 1 } }, true);
	const editor = view.getByLabelText("json editor");
	fireEvent.change(editor, { target: { value: '{ "a": ' } });
	expect(view.getByText(/Not valid JSON yet/)).toBeTruthy();
	expect(latest.extraBody).toEqual({ a: 1 });
	fireEvent.change(editor, { target: { value: "[1]" } });
	expect(view.getByText(/Must be a JSON object/)).toBeTruthy();
	expect(latest.extraBody).toEqual({ a: 1 });
	fireEvent.change(editor, { target: { value: '{ "b": 2 }' } });
	expect(view.queryByText(/Not valid JSON yet|Must be a JSON object/)).toBeNull();
	expect(latest.extraBody).toEqual({ b: 2 });
});
