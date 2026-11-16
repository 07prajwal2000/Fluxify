import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { RemoteBackup } from "@/services/backups";
import type { ArchiveSummary } from "@/services/projects";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// opening the restored project navigates; a Link needs a router, so both are stubbed
const navigate = mock((_: unknown) => {});
const router = { ...(await import("@tanstack/react-router")) };
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { backupsService } = await import("@/services/backups");
const { integrationService } = await import("@/services/integrations");
const { publicSettingsService } = await import("@/services/publicSettings");
const { authStore } = await import("@/store/auth");
const { RemoteBackups, restoredName } = await import("./RemoteBackups");

afterEach(cleanup);
afterAll(() => {
	GlobalRegistrator.unregister();
	mock.module("@tanstack/react-router", () => router);
});

async function until<T>(check: () => T, timeout = 1500): Promise<T> {
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

const text = () => document.body.textContent ?? "";
const buttons = (name: string) =>
	[...document.body.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);
/** the first row's Restore button, once the list is in */
const restoreButton = () => {
	const [found] = buttons("Restore");
	if (!found) throw new Error("no Restore");
	return found;
};
const field = (label: string) => {
	const found = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
	const input = found && document.getElementById(found.htmlFor);
	if (!input) throw new Error(`no field ${label}`);
	return input as HTMLInputElement;
};

const backup = (over: Partial<RemoteBackup> = {}): RemoteBackup => ({
	key: "orders/20261110T020000Z-b1.tar.gz",
	backupId: "b1",
	createdAt: "2026-11-10T02:00:00.000Z",
	mode: "backup",
	release: "2026.11.1",
	sizeBytes: 2048,
	source: { projectId: "p1", name: "Orders", slug: "orders" },
	sections: { routes: 2, workflows: 2 },
	hasReadme: false,
	...over,
});

const SUMMARY: ArchiveSummary = {
	mode: "backup",
	release: "2026.11.1",
	createdAt: "2026-11-10T02:00:00.000Z",
	source: { name: "Orders", slug: "orders" },
	sections: { routes: 2 },
	encrypted: true,
	readme: null,
	warnings: [],
	preview: [{ section: "routes", items: [] }],
	suggested: { name: "Orders (2)", slug: "orders-2" },
};

const VIEW = {
	schedule: {
		integrationId: "s3",
		prefix: "orders",
		interval: "daily" as const,
		retention: 7,
		enabled: true,
		sections: ["routes"],
		includeVersionHistory: false,
		includeAppConfigValues: false,
	},
	defaultPrefix: "orders",
	lastRun: null,
};

beforeEach(() => {
	mock.restore();
	navigate.mockClear();
	spyOn(integrationService, "getAll").mockResolvedValue([
		{ id: "s3", name: "bucket", group: "storage", variant: "S3 Compatible" },
	] as never);
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "active", canRun: true, canCreate: true, features: ["*"] },
	} as never);
	authStore.getState().actions.setUserData({ id: "u", name: "", email: "", isSystemAdmin: true });
});

function setup(projectId = "p1") {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<RemoteBackups projectId={projectId} view={VIEW} />
		</QueryClientProvider>,
	);
}

test("restoredName keeps within the 50 characters a name allows", () => {
	expect(restoredName("Orders", "2026-11-10T02:00:00.000Z")).toBe("Orders (restored 2026-11-10)");
	const long = restoredName("x".repeat(60), "2026-11-10T02:00:00.000Z");
	expect(long).toHaveLength(50);
	expect(long.endsWith(" (restored 2026-11-10)")).toBe(true);
});

test("lists the configured prefix's backups from their summaries", async () => {
	const prefixes = spyOn(backupsService, "remotePrefixes").mockResolvedValue(["orders", "shop"]);
	const list = spyOn(backupsService, "remoteBackups").mockResolvedValue([backup()]);
	setup();
	await until(() => expect(text()).toContain("Orders (orders)"));
	expect(list).toHaveBeenCalledWith("p1", "s3", "orders");
	expect(prefixes).toHaveBeenCalledWith("p1", "s3");
	expect(text()).toContain("2026.11.1");
	expect(text()).toContain("2.0 KB");
	expect(text()).toContain("Routes, Workflows");
	// its own backups: no "delete this one" hint
	expect(text()).not.toContain("you can delete this one afterwards");
});

test("on a fresh project, another project's backups come with the hint", async () => {
	spyOn(backupsService, "remotePrefixes").mockResolvedValue(["orders"]);
	spyOn(backupsService, "remoteBackups").mockResolvedValue([backup()]);
	setup("fresh");
	await until(() =>
		expect(text()).toContain(
			"Restoring creates a new project; you can delete this one afterwards.",
		),
	);
});

test("Restore opens the dialog with a prefilled name and the subdomain note, then creates the project", async () => {
	spyOn(backupsService, "remotePrefixes").mockResolvedValue(["orders"]);
	spyOn(backupsService, "remoteBackups").mockResolvedValue([backup()]);
	const inspect = spyOn(backupsService, "inspectRemote").mockResolvedValue(SUMMARY);
	const restore = spyOn(backupsService, "restoreRemote").mockResolvedValue({
		id: "p9",
		warnings: [],
	});
	setup();
	const row = await until(restoreButton);
	await act(async () => {
		fireEvent.click(row);
	});
	await until(() => expect(field("Project name").value).toBe("Orders (restored 2026-11-10)"));
	const target = { integrationId: "s3", key: "orders/20261110T020000Z-b1.tar.gz" };
	expect(inspect).toHaveBeenCalledWith("p1", target);
	expect(text()).toContain("New project from a backup");
	expect(text()).toContain("clear the subdomain here, then set it on the new project");
	expect(field("Slug").value).toBe("orders-2");

	await act(async () => {
		fireEvent.click(buttons("Create project")[0]!);
	});
	await until(() =>
		expect(navigate).toHaveBeenCalledWith({ to: "/$projectId", params: { projectId: "p9" } }),
	);
	expect(restore.mock.calls[0]?.[1]).toEqual(target);
	expect(restore.mock.calls[0]?.[2]).toMatchObject({ name: "Orders (restored 2026-11-10)" });
});

test("shows the server's refusal of an archive in the dialog", async () => {
	const { AxiosError } = await import("axios");
	spyOn(backupsService, "remotePrefixes").mockResolvedValue(["orders"]);
	spyOn(backupsService, "remoteBackups").mockResolvedValue([backup()]);
	spyOn(backupsService, "inspectRemote").mockRejectedValue(
		new AxiosError("Bad", "ERR_BAD_REQUEST", undefined, undefined, {
			status: 400,
			data: { message: "This backup is 600 MB; the largest that can be restored is 512 MB." },
		} as never),
	);
	setup();
	const row = await until(restoreButton);
	await act(async () => {
		fireEvent.click(row);
	});
	await until(() => expect(text()).toContain("the largest that can be restored is 512 MB"));
	expect(buttons("Create project")).toHaveLength(0);
});

test("only a system admin can restore", async () => {
	authStore.getState().actions.setUserData({ id: "u", name: "", email: "", isSystemAdmin: false });
	spyOn(backupsService, "remotePrefixes").mockResolvedValue(["orders"]);
	spyOn(backupsService, "remoteBackups").mockResolvedValue([backup()]);
	setup();
	const row = await until(restoreButton);
	expect(row.disabled).toBe(true);
	expect(text()).toContain("Only a system admin can restore");
});

test("says why the bucket can't be read", async () => {
	const { AxiosError } = await import("axios");
	spyOn(backupsService, "remotePrefixes").mockResolvedValue([]);
	spyOn(backupsService, "remoteBackups").mockRejectedValue(
		new AxiosError("Bad", "ERR_BAD_REQUEST", undefined, undefined, {
			status: 400,
			data: { message: 'Bucket "nope" does not exist' },
		} as never),
	);
	setup();
	await until(() => expect(text()).toContain('Bucket "nope" does not exist'));
});
