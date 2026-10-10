import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

mock.module("./ConnectorFields", () => ({
	ConnectorFields: ({ name, config }: { name: string; config: Record<string, unknown> }) => (
		<div data-testid="connector-fields">
			<span>Connector: {name}</span>
			<span>Host: {String(config?.host ?? "")}</span>
		</div>
	),
}));

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { EnvironmentIntegrationFields } = await import("./EnvironmentIntegrationFields");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function renderFields({
	syncDev = false,
	devConfig = null as Record<string, unknown> | null,
	onSyncDevChange = mock(),
} = {}) {
	return render(
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
		/>,
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
