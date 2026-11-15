import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { BackupSettings } = await import("./BackupSettings");
const { backupsService } = await import("@/services/backups");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");

type Row = Awaited<ReturnType<typeof backupsService.list>>["backups"][number];

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

// what the server's registry answers; `newThing` has no label here on purpose
const SECTIONS = [
	{ name: "appConfig", dependsOn: [] },
	{ name: "integrations", dependsOn: ["appConfig"] },
	{ name: "routes", dependsOn: ["integrations"] },
	{ name: "newThing", dependsOn: [] },
];

const row = (over: Partial<Row>): Row => ({
	id: "b1",
	type: "manual",
	mode: "backup",
	sections: [],
	formatVersions: {},
	release: "v2026.11.0",
	sizeBytes: 2048,
	status: "succeeded",
	error: null,
	downloadable: true,
	expiresAt: null,
	createdBy: { email: "ada@example.com", name: "Ada" },
	createdAt: new Date().toISOString(),
	finishedAt: new Date().toISOString(),
	...over,
});

const sections = spyOn(backupsService, "sections");
const list = spyOn(backupsService, "list");
const start = spyOn(backupsService, "start");
const settingsKeys = spyOn(projectSettingsKeysService, "getAll");
let rows: Row[] = [];
const download = mock((_url: string) => {});
let client: InstanceType<typeof QueryClient>;

beforeEach(() => {
	rows = [];
	download.mockReset();
	sections.mockReset().mockResolvedValue(SECTIONS);
	list.mockReset().mockImplementation(async () => ({ backups: rows, retentionDays: 7 }));
	start.mockReset().mockResolvedValue({ id: "new" });
	settingsKeys.mockReset().mockResolvedValue({} as never);
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup() {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<BackupSettings projectId="p1" download={download} />
		</QueryClientProvider>,
	);
}

const checkbox = (label: string) =>
	[...document.querySelectorAll('input[type="checkbox"]')].find((i) =>
		(i.closest("label") ?? i.parentElement)?.textContent?.includes(label),
	) as HTMLInputElement;
const button = (name: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
const mode = (name: string) =>
	[...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.includes(name))!;
const loaded = () => until(() => expect(checkbox("Routes")).toBeDefined());
const notes = () => [...document.querySelectorAll('[role="note"]')].map((n) => n.textContent);

test("offers the server's sections, labelled here and by their own name when new", async () => {
	setup();
	await loaded();
	expect(sections).toHaveBeenCalledWith("p1");
	for (const label of ["App config", "Integrations", "Routes", "newThing"])
		expect(checkbox(label)).toBeDefined();
	// the registry decides: nothing here is offered that it didn't list
	expect(document.body.textContent).not.toContain("Workflows");
});

test("starts with every section ticked, and version history and config values off", async () => {
	setup();
	await loaded();
	for (const label of ["App config", "Integrations", "Routes", "newThing"])
		expect(checkbox(label).checked).toBe(true);
	expect(checkbox("Canvas version history").checked).toBe(false);
	expect(checkbox("App config values").checked).toBe(false);
	expect(mode("Backup").getAttribute("aria-checked")).toBe("true");
});

test("Download backup sends the choices, then downloads the archive once it has succeeded", async () => {
	settingsKeys.mockResolvedValue({ "settings.backup.readme": "# Last time" } as never);
	setup();
	await loaded();
	fireEvent.click(checkbox("newThing"));
	fireEvent.click(checkbox("Canvas version history"));
	fireEvent.click(button("Download backup"));

	await until(() =>
		expect(start).toHaveBeenCalledWith("p1", {
			mode: "backup",
			sections: ["appConfig", "integrations", "routes"],
			includeVersionHistory: true,
			includeAppConfigValues: false,
			// the README the last backup used is the starting text
			readme: "# Last time",
		}),
	);
	expect(download).not.toHaveBeenCalled();

	// the run ends; the next poll shows it, and the page fetches the file
	rows = [row({ id: "new" })];
	await act(() => client.invalidateQueries({ queryKey: ["backups", "p1"] }));
	await until(() =>
		expect(download).toHaveBeenCalledWith("/_/admin/api/v1/p1/backups/new/download"),
	);
	expect(download).toHaveBeenCalledTimes(1);
});

test("a run that fails downloads nothing", async () => {
	setup();
	await loaded();
	fireEvent.click(button("Download backup"));
	await until(() => expect(start).toHaveBeenCalled());
	rows = [row({ id: "new", status: "failed", downloadable: false, error: "boom" })];
	await act(() => client.invalidateQueries({ queryKey: ["backups", "p1"] }));
	await until(() => expect(document.body.textContent).toContain("boom"));
	expect(download).not.toHaveBeenCalled();
});

test("a template cannot carry app config values and says what it leaves out", async () => {
	setup();
	await loaded();
	fireEvent.click(checkbox("App config values"));
	expect(checkbox("App config values").checked).toBe(true);

	fireEvent.click(mode("Template"));
	await until(() => expect(checkbox("App config values").disabled).toBe(true));
	expect(checkbox("App config values").checked).toBe(false);
	expect(document.body.textContent).toContain("A template never carries values");
	for (const left of [
		"secrets",
		"plugin approval",
		"uploaded knowledge documents",
		"production switches",
	])
		expect(mode("Template").textContent).toContain(left);

	fireEvent.click(button("Download backup"));
	await until(() =>
		expect(start.mock.calls.at(-1)?.[1]).toMatchObject({
			mode: "template",
			includeAppConfigValues: false,
		}),
	);
});

test("unticking a section others use warns under it, and ticking it again clears the warning", async () => {
	setup();
	await loaded();
	expect(notes()).toEqual([]);

	fireEvent.click(checkbox("Integrations"));
	await until(() =>
		expect(notes()).toEqual([
			"Routes use integrations; without them their connections come in empty.",
		]),
	);
	fireEvent.click(checkbox("Integrations"));
	await until(() => expect(notes()).toEqual([]));

	// a section nothing ticked uses has no hint
	fireEvent.click(checkbox("newThing"));
	await until(() => expect(checkbox("newThing").checked).toBe(false));
	expect(notes()).toEqual([]);
});

test("shows each backup's status, size, who and release, with a link only for a finished one", async () => {
	rows = [
		row({ id: "ok" }),
		row({
			id: "bad",
			status: "failed",
			downloadable: false,
			sizeBytes: null,
			release: null,
			error: 'Plugin "acme/echo" 1.0.0 could not be read for the backup',
		}),
		row({ id: "run", status: "running", downloadable: false, sizeBytes: null }),
		row({ id: "old", downloadable: false }),
	];
	setup();
	await until(() => expect(document.body.textContent).toContain("Succeeded"));
	const text = document.body.textContent ?? "";
	for (const expected of [
		"Failed",
		"Running",
		"2.0 KB",
		"Ada",
		"v2026.11.0",
		"Manual",
		"Expired (kept 7 days)",
	])
		expect(text).toContain(expected);
	// the error stands where the download would be
	expect(text).toContain('Plugin "acme/echo" 1.0.0');

	const links = [...document.querySelectorAll("a")].filter((a) => a.textContent === "Download");
	expect(links.map((a) => a.getAttribute("href"))).toEqual([
		"/_/admin/api/v1/p1/backups/ok/download",
	]);
});

test("one backup at a time: the button waits while one runs", async () => {
	rows = [row({ id: "run", status: "running", downloadable: false, sizeBytes: null })];
	setup();
	await until(() => expect(document.body.textContent).toContain("A backup is running"));
	expect(button("Download backup").hasAttribute("disabled")).toBe(true);
});

test("nothing ticked cannot be started", async () => {
	setup();
	await loaded();
	for (const label of ["App config", "Integrations", "Routes", "newThing"])
		fireEvent.click(checkbox(label));
	await until(() => expect(button("Download backup").hasAttribute("disabled")).toBe(true));
	expect(document.body.textContent).toContain("Pick at least one resource.");
});
