import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ObjectStorageBackup } = await import("./ObjectStorageBackup");
const { backupsService } = await import("@/services/backups");
const { integrationService } = await import("@/services/integrations");
const { publicSettingsService } = await import("@/services/publicSettings");

type View = Awaited<ReturnType<typeof backupsService.schedule>>;
type Row = NonNullable<View["lastRun"]>;

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

const INTEGRATION = "01900000-0000-7000-8000-000000000001";
const SELECTION = {
	sections: ["routes", "workflows"],
	includeVersionHistory: true,
	includeAppConfigValues: false,
};

const view = (schedule: Partial<View["schedule"]> = {}, lastRun: Row | null = null): View => ({
	schedule: {
		integrationId: INTEGRATION,
		prefix: "shop/prod",
		interval: "weekly",
		retention: 5,
		enabled: true,
		sections: ["routes", "workflows"],
		includeVersionHistory: true,
		includeAppConfigValues: false,
		...schedule,
	},
	defaultPrefix: "shop",
	lastRun,
});

const run = (over: Partial<Row>): Row => ({
	id: "b1",
	type: "object_storage",
	mode: "backup",
	sections: [],
	formatVersions: {},
	release: "v2026.11.0",
	sizeBytes: 10,
	status: "succeeded",
	error: null,
	downloadable: false,
	expiresAt: null,
	destinationKey: "shop/prod/20261116T000000Z-b1.tar.gz",
	createdBy: null,
	createdAt: new Date().toISOString(),
	finishedAt: new Date().toISOString(),
	...over,
});

const save = spyOn(backupsService, "saveSchedule");
const now = spyOn(backupsService, "backupNow");
const integrations = spyOn(integrationService, "getAll");
const license = spyOn(publicSettingsService, "get");
const licensed = (features: string[]) =>
	license.mockResolvedValue({
		license: {
			status: features.length ? "active" : "community",
			canRun: true,
			canCreate: features.length > 0,
			features,
		},
	} as never);

beforeEach(() => {
	save.mockReset().mockImplementation(async () => view());
	now.mockReset().mockResolvedValue({ id: "b2" });
	integrations
		.mockReset()
		.mockResolvedValue([{ id: INTEGRATION, name: "backups-bucket", group: "storage" }] as never);
	licensed(["objectStorageBackups"]);
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup(v: View = view()) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ObjectStorageBackup projectId="p1" view={v} selection={SELECTION} />
		</QueryClientProvider>,
	);
}

const button = (name: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
/** the one monospace text input */
const prefixInput = () => document.querySelector<HTMLInputElement>("input.font-mono")!;
const disabled = (b: HTMLButtonElement) =>
	b.disabled || b.getAttribute("aria-disabled") === "true" || b.hasAttribute("data-disabled");

test("Save sends the settings with the resources picked above", async () => {
	setup();
	await until(() => expect(button("Save")).toBeDefined());
	fireEvent.click(button("Save"));
	await until(() =>
		expect(save).toHaveBeenCalledWith("p1", {
			integrationId: INTEGRATION,
			prefix: "shop/prod",
			interval: "weekly",
			retention: 5,
			enabled: true,
			...SELECTION,
		}),
	);
});

test("starts the prefix at the project's slug", async () => {
	setup(view({ integrationId: null, prefix: "" }));
	await until(() => expect((prefixInput() as HTMLInputElement).value).toBe("shop"));
	// nothing saved yet: no integration, so no saving and no "Back up now"
	expect(disabled(button("Save"))).toBe(true);
	expect(disabled(button("Back up now"))).toBe(true);
});

test("refuses a prefix with a slash at either end before saving", async () => {
	setup();
	await until(() => expect(prefixInput()).toBeDefined());
	fireEvent.change(prefixInput(), { target: { value: "/shop/" } });
	await until(() => expect(document.body.textContent).toContain("with no '/' at either end"));
	expect(disabled(button("Save"))).toBe(true);
});

test("Back up now uploads with the saved settings", async () => {
	setup();
	await until(() => expect(disabled(button("Back up now"))).toBe(false));
	fireEvent.click(button("Back up now"));
	await until(() => expect(now).toHaveBeenCalledWith("p1"));
});

test("shows where the last backup went, or why it failed", async () => {
	setup(view({}, run({})));
	await until(() =>
		expect(document.body.textContent).toContain("shop/prod/20261116T000000Z-b1.tar.gz"),
	);
	cleanup();
	setup(view({}, run({ status: "failed", error: 'Bucket "x" does not exist.' })));
	const alert = await until(() => document.querySelector('[role="alert"]')!);
	expect(alert.textContent).toContain('Bucket "x" does not exist.');
});

test("says to choose a prefix after a restore switched it off", async () => {
	setup(view({ prefix: "", enabled: false }));
	await until(() =>
		expect(document.body.textContent).toContain("Choose a prefix no other project uses"),
	);
});

test("is locked without the license, with the settings still shown", async () => {
	licensed([]);
	setup();
	await until(() => expect(document.body.textContent).toContain("Enterprise only"));
	expect(document.body.textContent).toContain("The settings and history are kept");
	expect(document.querySelector("[inert]")?.textContent).toContain("Back up now");
	expect((prefixInput() as HTMLInputElement).value).toBe("shop/prod");
});
