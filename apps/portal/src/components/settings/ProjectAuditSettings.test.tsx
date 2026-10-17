import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// the link goes through the router; stand in for it and show what it was given
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
const { ProjectAuditSettings } = await import("./ProjectAuditSettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { publicSettingsService } = await import("@/services/publicSettings");
const { authStore } = await import("@/store/auth");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

type Role = "viewer" | "creator" | "project_admin";

async function setup({
	role = "project_admin",
	isSystemAdmin = false,
	features = ["auditLogs"],
	settings = {},
}: {
	role?: Role;
	isSystemAdmin?: boolean;
	features?: string[];
	settings?: Record<string, string>;
} = {}) {
	authStore.getState().actions.setUserData({ id: "u1", name: "U", email: "u@x.io", isSystemAdmin });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "active", canRun: true, canCreate: true, features },
	} as never);
	spyOn(projectSettingsKeysService, "getAll").mockResolvedValue(settings as never);
	const upsert = spyOn(projectSettingsKeysService, "upsert").mockResolvedValue({} as never);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ProjectAuditSettings projectId="p1" />
		</QueryClientProvider>,
	);
	const ui = within(document.body);
	await until(() => ui.getByText("Record audit logs for this project"));
	const box = () => document.querySelector<HTMLInputElement>("input[type=checkbox]")!;
	return { ui, upsert, box };
}

test("links to the audit page with this project as the filter", async () => {
	const { ui } = await setup({ isSystemAdmin: true });
	await until(() => {
		const link = ui.getByText("View this project's audit logs") as HTMLAnchorElement;
		const url = new URL(link.getAttribute("href")!, "http://x");
		expect(url.pathname).toBe("/");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			tab: "instance",
			settingsTab: "audit",
			project: "p1",
		});
	});
});

test("no link for someone who cannot open the page", async () => {
	const { box, ui } = await setup({ isSystemAdmin: false });
	await until(() => expect(box().disabled).toBe(false)); // the licence has loaded
	expect(ui.queryByText("View this project's audit logs")).toBeNull();
});

test("reads no saved value as off, and turning it on saves true", async () => {
	const { box, upsert } = await setup();
	await until(() => expect(box().disabled).toBe(false));
	expect(box().checked).toBe(false);
	await act(async () => void fireEvent.click(box()));
	await until(() =>
		expect(upsert).toHaveBeenCalledWith("p1", { key: "auditLogs.enabled", value: "true" }),
	);
});

test("shows a saved on, and turning it off saves false", async () => {
	const { box, upsert } = await setup({ settings: { "auditLogs.enabled": "true" } });
	await until(() => expect(box().checked).toBe(true));
	await act(async () => void fireEvent.click(box()));
	await until(() =>
		expect(upsert).toHaveBeenCalledWith("p1", { key: "auditLogs.enabled", value: "false" }),
	);
});

test("a creator can read it but not change it, and is told who can", async () => {
	const { box, ui } = await setup({ role: "creator" });
	await until(() => {
		expect(box().disabled).toBe(true);
		expect(ui.getByText("Only a project admin can change this.")).toBeTruthy();
	});
});

test("without the licence the toggle is locked, with the reason, and there is no link", async () => {
	const { box, ui } = await setup({ features: ["connectors"], isSystemAdmin: true });
	await until(() => {
		expect(box().disabled).toBe(true);
		expect(ui.getByText("Audit logs need an Enterprise license that includes them.")).toBeTruthy();
	});
	expect(ui.queryByText("View this project's audit logs")).toBeNull();
});
