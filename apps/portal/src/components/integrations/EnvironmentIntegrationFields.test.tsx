import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { EnvironmentIntegrationFields } = await import("./EnvironmentIntegrationFields");

afterEach(cleanup);

function renderFields({
	syncDev = false,
	devConfig = null as Record<string, unknown> | null,
	onSyncDevChange = mock(),
	tabs = false,
} = {}) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<EnvironmentIntegrationFields
				projectId="proj-1"
				group="database"
				variant="PostgreSQL"
				name="main-db"
				onName={mock()}
				config={{ host: "prod.db.internal" }}
				setField={mock()}
				devConfig={devConfig}
				setDevField={mock()}
				syncDev={syncDev}
				onSyncDevChange={onSyncDevChange}
				tabs={tabs}
			/>
		</QueryClientProvider>,
	);
}

test("when Same as production is checked, shows warning alert and hides dev form", () => {
	const view = renderFields({ syncDev: true });

	const alert = view.getByRole("alert");
	expect(alert).toBeTruthy();
	expect(alert.textContent).toContain("Same as production");
	expect(alert.textContent).toContain(
		"Dev runs, dev triggers and AI agents will read and write production — same database, same queues, same consumer groups. Use separate dev instances instead.",
	);
	expect(view.queryByText("Configuration for local and development runs.")).toBeNull();
});

test("when Same as production is unchecked, hides warning alert and shows dev form", () => {
	const view = renderFields({ syncDev: false, devConfig: { host: "localhost" } });

	expect(view.queryByRole("alert")).toBeNull();
	expect(view.getByText("Configuration for local and development runs.")).toBeTruthy();
});

test("when dev config is empty, shows inline warning hint", () => {
	const view = renderFields({ syncDev: false, devConfig: {} });

	const hint = view.getByText(
		"Dev workers will fail until you set a development value or turn on Same as production.",
	);
	expect(hint).toBeTruthy();
});

test("when dev config is provided, hides inline warning hint", () => {
	const view = renderFields({ syncDev: false, devConfig: { host: "localhost" } });

	expect(
		view.queryByText(
			"Dev workers will fail until you set a development value or turn on Same as production.",
		),
	).toBeNull();
});

test("toggling Same as production invokes onSyncDevChange", () => {
	const onSyncDevChange = mock();
	const view = renderFields({ syncDev: false, onSyncDevChange });

	const checkbox = view.getByLabelText("Same as production");
	fireEvent.click(checkbox);
	expect(onSyncDevChange).toHaveBeenCalledWith(true);
});

// The saved integration's page (#933): Production and Development as tabs, Same as prod in its header.
const tab = (view: ReturnType<typeof render>, name: RegExp) => view.getByRole("tab", { name });

test("as tabs, Production is open by default and the Same as prod checkbox is not in the form", () => {
	const view = renderFields({ tabs: true, devConfig: { host: "localhost" } });
	expect(tab(view, /Production/).getAttribute("aria-selected")).toBe("true");
	expect(view.getByDisplayValue("prod.db.internal")).toBeTruthy();
	expect(view.queryByDisplayValue("localhost")).toBeNull();
	expect(view.queryByRole("checkbox", { name: /Same as prod/i })).toBeNull();
});

test("as tabs, Same as prod disables the Development tab and says why on it", () => {
	const view = renderFields({ tabs: true, syncDev: true, devConfig: { host: "localhost" } });
	const dev = tab(view, /Development/);
	expect(dev.getAttribute("aria-disabled")).toBe("true");
	expect(dev.textContent).toContain("Same as prod");
	// the production warning still shows while it is on
	expect(view.getByRole("alert").textContent).toContain("read and write production");
});

test("as tabs, without Same as prod the Development tab opens with its own values", () => {
	const view = renderFields({ tabs: true, devConfig: { host: "localhost" } });
	const dev = tab(view, /Development/);
	expect(dev.getAttribute("aria-disabled")).not.toBe("true");
	expect(dev.textContent).not.toContain("Same as prod");
	fireEvent.click(dev);
	expect(view.getByDisplayValue("localhost")).toBeTruthy();
});
