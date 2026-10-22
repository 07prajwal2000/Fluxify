import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useBlocker: () => {},
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { IntegrationOnboardingForm } = await import("./IntegrationOnboardingForm");
const { integrationService } = await import("@/services/integrations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const wrap = (node: ReactNode, queryClient?: InstanceType<typeof QueryClient>) => {
	const qc =
		queryClient ??
		new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
	return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

test("IntegrationOnboardingForm renders plugin variant card with Plugin badge", async () => {
	const variants = [
		{
			group: "crm",
			label: "CRM",
			builtIn: false,
			variants: [
				{
					variant: "HubSpot",
					label: "HubSpot",
					builtIn: false,
					plugin: { id: "pl-1", name: "acme/crm", namespace: "acme" },
				},
			],
		},
	] as unknown as Awaited<ReturnType<typeof integrationService.getVariants>>;

	spyOn(integrationService, "getVariants").mockResolvedValue(variants);
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	qc.setQueryData(["integration-variants", "p1"], variants);

	wrap(
		<IntegrationOnboardingForm projectId="p1" group="crm" onSelect={() => {}} onSaved={() => {}} />,
		qc,
	);

	await waitFor(() => {
		expect(document.body.textContent).toContain("HubSpot");
	});

	// Step 2 shows the provider
	const badge = within(document.body).getByText("Plugin");
	expect(badge).toBeTruthy();
});

test("IntegrationOnboardingForm displays test connection error text verbatim", async () => {
	const variants = [
		{
			group: "database",
			label: "Databases",
			builtIn: true,
			variants: [
				{
					variant: "CockroachDB",
					label: "CockroachDB",
					builtIn: false,
					plugin: { id: "pl-1", name: "acme/cockroach", namespace: "acme" },
				},
			],
		},
	] as unknown as Awaited<ReturnType<typeof integrationService.getVariants>>;

	spyOn(integrationService, "getVariants").mockResolvedValue(variants);
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	qc.setQueryData(["integration-variants", "p1"], variants);

	spyOn(integrationService, "testConnection").mockRejectedValue(
		new Error("Worker connection timeout after 5000ms: acme/cockroach unavailable"),
	);

	wrap(
		<IntegrationOnboardingForm
			projectId="p1"
			group="database"
			variant="CockroachDB"
			onSelect={() => {}}
			onSaved={() => {}}
		/>,
		qc,
	);

	await waitFor(() => {
		expect(document.body.textContent).toContain("Configure CockroachDB");
	});

	// Turn on Same as production so test does not bail on empty dev config
	const syncDevCheckbox = within(document.body).getByLabelText("Same as production");
	await act(async () => void fireEvent.click(syncDevCheckbox));

	const testBtn = within(document.body).getByRole("button", { name: /Test connection/i });
	await act(async () => void fireEvent.click(testBtn));

	await waitFor(() => {
		expect(document.body.textContent).toContain(
			"Worker connection timeout after 5000ms: acme/cockroach unavailable",
		);
	});
});

test("IntegrationOnboardingForm renders Name field for plugin variant and sends it on save", async () => {
	const variants = [
		{
			group: "demo/email",
			label: "Email",
			builtIn: false,
			variants: [
				{
					variant: "smtp",
					label: "SMTP",
					builtIn: false,
					plugin: { id: "pl-1", name: "demo/toolkit", namespace: "demo" },
					params: {
						host: { type: "string", label: "Host", required: true },
					},
				},
			],
		},
	] as unknown as Awaited<ReturnType<typeof integrationService.getVariants>>;

	spyOn(integrationService, "getVariants").mockResolvedValue(variants);
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	qc.setQueryData(["integration-variants", "p1"], variants);

	const createSpy = spyOn(integrationService, "create").mockResolvedValue({
		id: "int-new",
		name: "My SMTP",
		group: "demo/email",
		variant: "smtp",
		config: { host: "smtp.example.com" },
		devConfig: null,
		syncDev: true,
	} as unknown as Awaited<ReturnType<typeof integrationService.create>>);

	const onSaved = mock();

	wrap(
		<IntegrationOnboardingForm
			projectId="p1"
			group="demo/email"
			variant="smtp"
			onSelect={() => {}}
			onSaved={onSaved}
		/>,
		qc,
	);

	await waitFor(() => {
		expect(document.getElementById("plugin-integration-name")).not.toBeNull();
	});

	const getNameInput = () => {
		const el = document.getElementById("plugin-integration-name");
		if (!el) throw new Error("plugin-integration-name not found");
		return (el.tagName === "INPUT" ? el : el.querySelector("input") || el) as HTMLInputElement;
	};

	expect(getNameInput()).toBeTruthy();

	const hostInput = within(document.body).getAllByLabelText(/Host/)[0];
	if (!hostInput) throw new Error("Host input not found");
	await act(
		async () => void fireEvent.change(hostInput, { target: { value: "smtp.example.com" } }),
	);

	const saveBtn = within(document.body).getByRole("button", { name: /Connect smtp/i });
	await act(async () => void fireEvent.click(saveBtn));
	expect(createSpy).not.toHaveBeenCalled();

	const activeNameInput = getNameInput();
	await act(async () => void fireEvent.change(activeNameInput, { target: { value: "My SMTP" } }));

	const syncDev = within(document.body).getByLabelText("Same as production");
	await act(async () => void fireEvent.click(syncDev));

	await act(async () => void fireEvent.click(saveBtn));

	await waitFor(() => {
		expect(createSpy).toHaveBeenCalledWith(
			"p1",
			expect.objectContaining({
				name: "My SMTP",
				group: "demo/email",
				variant: "smtp",
			}),
		);
	});
});
