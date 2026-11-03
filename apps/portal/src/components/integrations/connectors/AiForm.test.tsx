import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useState } = await import("react");
const { AiForm } = await import("./AiForm");
const { setPath } = await import("../ConnectorFields");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

let latest: Record<string, unknown> = {};

// holds the config the way the integration page does, so the editor sees its own changes echo back
function Harness({ initial }: { initial: Record<string, unknown> }) {
	const [config, setConfig] = useState(initial);
	latest = config;
	return (
		<AiForm
			projectId="p"
			name="gpt"
			onName={() => {}}
			config={config}
			setField={(path, value) => setConfig((c) => setPath(c, path, value))}
		/>
	);
}

function renderForm(initial: Record<string, unknown> = {}) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<Harness initial={initial} />
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
