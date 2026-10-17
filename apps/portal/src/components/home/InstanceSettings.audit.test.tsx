import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({
		to,
		search,
		children,
		...rest
	}: {
		to: string;
		search?: Record<string, string>;
		children: ReactNode;
	}) => (
		<a href={`${to}?${new URLSearchParams(search)}`} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
/** Not RTL's waitFor/findBy/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
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

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { InstanceSettings } = await import("./InstanceSettings");
const { auditLogsService } = await import("@/services/auditLogs");
const { publicSettingsService } = await import("@/services/publicSettings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
	mock.restore();
});

function setup(features: string[], activeTab: string, project?: string) {
	const onProjectChange = mock();
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "active", canRun: true, canCreate: true, features },
	} as never);
	const list = spyOn(auditLogsService, "list").mockResolvedValue({ data: [], nextCursor: null });
	spyOn(auditLogsService, "filters").mockResolvedValue({
		resourceTypes: [],
		actions: [],
		projects: [],
	});
	render(
		<QueryClientProvider client={new QueryClient()}>
			<InstanceSettings activeTab={activeTab} project={project} onProjectChange={onProjectChange} />
		</QueryClientProvider>,
	);
	return { list, onProjectChange, ui: within(document.body) };
}

test("the Audit logs section shows with the licence feature", async () => {
	const { ui } = setup(["auditLogs"], "license");
	const link = (await until(() => ui.getByText("Audit logs"))) as HTMLElement;
	const url = new URL(link.closest("a")!.getAttribute("href")!, "http://x");
	expect(Object.fromEntries(url.searchParams)).toEqual({ tab: "instance", settingsTab: "audit" });
});

test("the Audit logs section is hidden without it", async () => {
	// on the audit page itself, so the licence has loaded once its locked message shows
	const { ui } = setup(["connectors"], "audit");
	await until(() => ui.getByText("Enterprise only"));
	expect(ui.queryByRole("link", { name: "Audit logs" })).toBeNull();
});

test("opens the page with the project from the URL as its filter", async () => {
	const { list, ui } = setup(["auditLogs"], "audit", "p9");
	expect(await until(() => ui.getByText("No events match these filters"))).toBeTruthy();
	expect(list.mock.calls[0]![0]).toMatchObject({ projectId: "p9" });
});

test("changing the project hands it back to be written to the URL", async () => {
	const { onProjectChange, ui } = setup(["auditLogs"], "audit", "p9");
	fireEvent.click(await until(() => ui.getByText("Clear filters")));
	expect(onProjectChange).toHaveBeenCalledWith(undefined);
});

test("a link to the page without the licence shows it locked", async () => {
	const { list, ui } = setup(["connectors"], "audit", "p9");
	expect(await until(() => ui.getByText("Enterprise only"))).toBeTruthy();
	expect(list).not.toHaveBeenCalled();
});
