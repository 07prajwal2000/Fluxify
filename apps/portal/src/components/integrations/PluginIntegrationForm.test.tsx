import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

mock.module("./AppConfigSelectorModal", () => ({
	AppConfigSelectorModal: ({
		isOpen,
		onSelect,
	}: {
		isOpen: boolean;
		onSelect: (k: string) => void;
	}) =>
		isOpen ? (
			<div data-testid="appconfig-modal">
				<button type="button" onClick={() => onSelect("APP_SECRET")}>
					Select APP_SECRET
				</button>
			</div>
		) : null,
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { PluginIntegrationForm, IntegrationSecretField } = await import("./PluginIntegrationForm");
const { EnvironmentIntegrationFields } = await import("./EnvironmentIntegrationFields");
const { IntegrationInspectPanel } = await import("./IntegrationInspectPanel");
const { integrationService } = await import("@/services/integrations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const wrap = (node: ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

test("IntegrationSecretField renders secret picker, stores cfg:KEY, never raw input", () => {
	let secretValue = "";
	const onChange = mock((v: string) => {
		secretValue = v;
	});

	const { rerender } = render(
		<IntegrationSecretField
			projectId="p1"
			name="apiKey"
			label="API Key"
			hint="Your service key"
			value={secretValue}
			onChange={onChange}
		/>,
	);

	expect(document.body.textContent).toContain("API Key");
	expect(document.body.textContent).toContain("Select an app config key...");
	// No raw text input exists in the secret field
	expect(document.querySelector('input[type="text"]')).toBeNull();

	// Click Pick Key
	const pickBtn = within(document.body).getByRole("button", { name: "Pick Key" });
	fireEvent.click(pickBtn);

	// Select key from modal
	const modalBtn = within(document.body).getByText("Select APP_SECRET");
	fireEvent.click(modalBtn);

	expect(onChange).toHaveBeenCalledWith("cfg:APP_SECRET");

	// Rerender with chosen key
	rerender(
		<IntegrationSecretField
			projectId="p1"
			name="apiKey"
			label="API Key"
			hint="Your service key"
			value="cfg:APP_SECRET"
			onChange={onChange}
		/>,
	);

	expect(document.body.textContent).toContain("cfg:APP_SECRET");
	// Clear secret
	const clearBtn = within(document.body).getByRole("button", { name: "Clear secret" });
	fireEvent.click(clearBtn);
	expect(onChange).toHaveBeenCalledWith("");
});

test("PluginIntegrationForm renders tabs and fields", () => {
	const params = {
		host: {
			type: "string" as const,
			label: "Host",
			default: "localhost",
			tab: "Connection",
		},
		token: {
			type: "secret" as const,
			label: "Auth Token",
			tab: "Auth",
		},
	};
	const setField = mock();

	wrap(
		<PluginIntegrationForm
			projectId="p1"
			variant="cockroach"
			params={params as any}
			tabs={["Connection", "Auth"]}
			config={{ host: "localhost", token: "cfg:TOKEN" }}
			setField={setField}
		/>,
	);

	// Tabs exist
	expect(within(document.body).getByRole("tab", { name: "Connection" })).toBeTruthy();
	expect(within(document.body).getByRole("tab", { name: "Auth" })).toBeTruthy();
	expect(document.body.textContent).toContain("Host");

	// Switch tab
	fireEvent.click(within(document.body).getByRole("tab", { name: "Auth" }));
	expect(document.body.textContent).toContain("Auth Token");
	expect(document.body.textContent).toContain("cfg:TOKEN");
});

test("EnvironmentIntegrationFields displays form-level error for field-less issues", () => {
	wrap(
		<EnvironmentIntegrationFields
			projectId="p1"
			group="database"
			variant="postgres"
			name="Prod DB"
			onName={() => {}}
			config={{}}
			setField={() => {}}
			devConfig={null}
			setDevField={() => {}}
			syncDev={false}
			onSyncDevChange={() => {}}
			formError="Invalid combination of parameters on connector"
		/>,
	);

	const alert = within(document.body).getByRole("alert");
	expect(alert.textContent).toContain("Invalid combination of parameters on connector");
});

test("IntegrationInspectPanel executes inspect and displays result", async () => {
	const inspectSpy = spyOn(integrationService, "inspect").mockResolvedValue({
		status: "healthy",
		collections: ["users", "orders"],
	});

	wrap(<IntegrationInspectPanel projectId="p1" integrationId="int-1" />);

	expect(document.body.textContent).toContain("Inspect");
	expect(document.body.textContent).toContain("Query metadata or test inspection hooks");
	const runBtn = [...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Inspect"),
	);
	expect(runBtn).toBeTruthy();
	await act(async () => void fireEvent.click(runBtn!));

	// Wait for inspect to be called
	expect(inspectSpy).toHaveBeenCalledWith("p1", "int-1", {}, "development");
	await act(async () => new Promise((r) => setTimeout(r, 50)));

	expect(document.body.textContent).toContain("healthy");
	expect(document.body.textContent).toContain("collections");
});
