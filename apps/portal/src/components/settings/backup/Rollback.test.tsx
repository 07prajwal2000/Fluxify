import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { RemoteBackup, RollbackSummary } from "@/services/backups";

// Rolling a project back in place (#1130), from a Remote backups row: the
// choices, what they change, the confirm for removals, and the refusal of a
// removal that would break what stays. DOM only for this file.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

const router = { ...(await import("@tanstack/react-router")) };
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => () => {},
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { backupsService } = await import("@/services/backups");
const { integrationService } = await import("@/services/integrations");
const { publicSettingsService } = await import("@/services/publicSettings");
const { authStore } = await import("@/store/auth");
const { RemoteBackups } = await import("./RemoteBackups");

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
/** the last match: the dialog renders after the page, so its Roll back wins over the row's */
const button = (name: string) => {
	const found = [...document.body.querySelectorAll("button")]
		.filter((b) => b.textContent?.trim() === name)
		.at(-1);
	if (!found) throw new Error(`no button ${name}`);
	return found;
};
const checkbox = (label: string) =>
	[...document.querySelectorAll('input[type="checkbox"]')].find((i) =>
		(i.closest("label") ?? i.parentElement)?.textContent?.includes(label),
	) as HTMLInputElement;
const mode = (name: string) =>
	[...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.includes(name))!;
const press = (el: Element) => act(async () => void fireEvent.click(el));

const BACKUP: RemoteBackup = {
	key: "orders/20261110T020000Z-b1.tar.gz",
	backupId: "b1",
	createdAt: "2026-11-10T02:00:00.000Z",
	mode: "backup",
	release: "2026.11.1",
	sizeBytes: 2048,
	source: { projectId: "p1", name: "Orders", slug: "orders" },
	sections: { customBlocks: 2, routes: 2 },
	hasReadme: false,
};
const TARGET = { integrationId: "s3", key: BACKUP.key };

const summary = (
	conflicts: RollbackSummary["rollback"]["conflicts"] = [],
	notes: RollbackSummary["rollback"]["notes"] = [],
): RollbackSummary => ({
	mode: "backup",
	release: "2026.11.1",
	createdAt: "2026-11-10T02:00:00.000Z",
	source: { name: "Orders", slug: "orders" },
	sections: { customBlocks: 2, routes: 2 },
	encrypted: true,
	readme: null,
	warnings: [],
	preview: [
		{ section: "customBlocks", items: [] },
		{ section: "routes", items: [] },
	],
	rollback: {
		sections: [
			{ section: "customBlocks", update: [], create: [], extras: ["auth"], replaced: false },
			{ section: "routes", update: ["x", "y"], create: [], extras: ["z"], replaced: false },
		],
		conflicts,
		notes,
	},
});

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
	spyOn(integrationService, "getAll").mockResolvedValue([
		{ id: "s3", name: "bucket", group: "storage", variant: "S3 Compatible" },
	] as never);
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "active", canRun: true, canCreate: true, features: ["*"] },
	} as never);
	// rolling back needs the project, not a system admin
	authStore.getState().actions.setUserData({ id: "u", name: "", email: "", isSystemAdmin: false });
	spyOn(backupsService, "remotePrefixes").mockResolvedValue(["orders"]);
	spyOn(backupsService, "remoteBackups").mockResolvedValue([BACKUP]);
});

async function openRollback(s: RollbackSummary) {
	const inspect = spyOn(backupsService, "inspectRemoteRollback").mockResolvedValue(s);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<RemoteBackups projectId="p1" view={VIEW} />
		</QueryClientProvider>,
	);
	await press(await until(() => button("Roll back")));
	await until(() => expect(checkbox("Routes")).toBeDefined());
	expect(inspect).toHaveBeenCalledWith("p1", TARGET);
}

test("keep extras: every section, today's credentials, the counts say what stays", async () => {
	const rollback = spyOn(backupsService, "remoteRollback").mockResolvedValue({
		backupId: "b9",
		warnings: [],
	});
	await openRollback(summary());
	expect(text()).toContain("2 updated · 0 created · 1 kept");
	expect(checkbox("Also restore credentials").checked).toBe(false);

	await press(button("Roll back"));
	await until(() => expect(rollback).toHaveBeenCalled());
	expect(rollback.mock.calls[0]).toEqual([
		"p1",
		TARGET,
		{ mode: "keep", sections: ["customBlocks", "routes"], restoreSecrets: false },
	]);
});

test("exact replica asks first, naming what it removes", async () => {
	const rollback = spyOn(backupsService, "remoteRollback").mockResolvedValue({
		backupId: "b9",
		warnings: [{ section: "project", message: "Compilation could not be queued" }],
	});
	await openRollback(summary());
	await press(mode("Exact replica"));
	expect(text()).toContain("2 updated · 0 created · 1 removed");
	await press(checkbox("Custom blocks"));

	await press(button("Roll back"));
	await until(() => expect(text()).toContain("These are not in the backup and will be removed"));
	expect(text()).toContain("Routes: z");
	expect(text()).not.toContain("Custom blocks: auth");
	expect(rollback).not.toHaveBeenCalled();

	await press(button("Remove and roll back"));
	await until(() => expect(text()).toContain("Rolled back, with a few things to do"));
	expect(rollback.mock.calls[0]?.[2]).toEqual({
		mode: "exact",
		sections: ["routes"],
		restoreSecrets: false,
	});
});

test("refuses an exact replica that would break a resource it keeps", async () => {
	const message =
		'Route "r1" uses the custom block "auth", which an exact replica would remove. Restore the routes too, or keep extras.';
	await openRollback(
		summary([{ message, mode: "exact", selected: ["customBlocks"], kept: ["routes"] }]),
	);
	const dialogButton = () => button("Roll back");
	// keep extras, or routes restored too: fine
	expect(text()).not.toContain(message);
	await press(mode("Exact replica"));
	expect(text()).not.toContain(message);
	expect(dialogButton().disabled).toBe(false);

	await press(checkbox("Routes"));
	await until(() => expect(text()).toContain(message));
	expect(dialogButton().disabled).toBe(true);
});

test("warnings follow the choices, and an exact replica's show beside the removal list", async () => {
	spyOn(backupsService, "remoteRollback").mockResolvedValue({ backupId: "b9", warnings: [] });
	const removal = 'App config key "API_KEY" will be removed, but route "r1" may still read it.';
	const lost = `Route "x" uses integrations this backup doesn't restore: block db_1 ("pg").`;
	await openRollback(
		summary(
			[],
			[
				// the project has "pg": only an exact replica that restores integrations loses it
				{
					section: "routes",
					message: lost,
					mode: "exact",
					selected: ["routes", "integrations"],
					kept: [],
				},
				{
					section: "appConfig",
					message: removal,
					mode: "exact",
					selected: ["routes"],
					kept: ["customBlocks"],
					removal: true,
				},
			],
		),
	);
	expect(text()).not.toContain(removal);
	await press(mode("Exact replica"));
	expect(text()).not.toContain(removal);
	await press(checkbox("Custom blocks"));
	await until(() => expect(text()).toContain(removal));
	expect(text()).not.toContain(lost);

	await press(button("Roll back"));
	await until(() => expect(text()).toContain("These are not in the backup and will be removed"));
	const list = [...document.querySelectorAll('[aria-label="Removal warnings"]')];
	// once in the form, once in the confirm
	expect(list).toHaveLength(2);
	expect(list.at(-1)?.textContent).toContain(removal);
});
