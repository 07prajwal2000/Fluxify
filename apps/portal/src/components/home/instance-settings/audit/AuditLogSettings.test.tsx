import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
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
const { AuditLogSettings } = await import("./AuditLogSettings");
const { auditLogsService } = await import("@/services/auditLogs");
const { publicSettingsService } = await import("@/services/publicSettings");

type Row = import("@/services/auditLogs").AuditRow;

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const row = (n: number, over: Partial<Row> = {}): Row => ({
	id: `019a0000-0000-7000-8000-${String(n).padStart(12, "0")}`,
	ts: "2026-10-17T10:00:00.000Z",
	actorId: "u1",
	actorEmail: "ada@x.io",
	source: "portal",
	projectId: "p1",
	projectName: "Shop",
	projectSlug: "shop",
	projectDeleted: false,
	resourceType: "route",
	resourceId: `res-${n}`,
	action: "update",
	changedFields: ["name"],
	status: "success",
	message: null,
	...over,
});

const license = (features: string[]) =>
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "active", canRun: true, canCreate: true, features },
	} as never);

const options = {
	resourceTypes: ["route", "workflow"],
	actions: ["create", "update"],
	projects: [
		{ id: "p1", name: "Shop", slug: "shop", deleted: false },
		{ id: "gone", name: "Old Shop", slug: "old-shop", deleted: true },
	],
};

function setup({
	pages = [{ data: [row(1)], nextCursor: null as string | null }],
	project,
	features = ["auditLogs"],
}: {
	pages?: { data: Row[]; nextCursor: string | null }[];
	project?: string;
	features?: string[];
} = {}) {
	license(features);
	const list = spyOn(auditLogsService, "list");
	pages.forEach((page, i) => {
		if (i === pages.length - 1) list.mockResolvedValue(page);
		else list.mockResolvedValueOnce(page);
	});
	spyOn(auditLogsService, "filters").mockResolvedValue(options);
	const onProjectChange = mock();
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<AuditLogSettings project={project} onProjectChange={onProjectChange} />
		</QueryClientProvider>,
	);
	return { list, onProjectChange, ui: within(document.body) };
}

test("lists the events with who, project, resource, action and what changed", async () => {
	const { ui } = setup({
		pages: [
			{
				data: [row(1, { changedFields: ["name", "path", "method", "active"], action: "delete" })],
				nextCursor: null,
			},
		],
	});
	expect(await until(() => ui.getByText("res-1"))).toBeTruthy();
	expect(ui.getByText("ada@x.io")).toBeTruthy();
	expect(ui.getAllByText("Shop").length).toBeGreaterThan(0);
	expect(ui.getByText("delete")).toBeTruthy();
	// three chips and a "+1", never a value
	expect(ui.getByText("name")).toBeTruthy();
	expect(ui.getByText("+1")).toBeTruthy();
	expect(ui.queryByText("active")).toBeNull();
});

test("labels how each event came in", async () => {
	const { ui } = setup({
		pages: [
			{
				data: [
					row(1, { source: "portal", actorEmail: "p@x.io" }),
					row(2, { source: "mcp", actorEmail: "m@x.io" }),
					row(3, { source: "pat", actorEmail: "t@x.io" }),
					row(4, { source: "agent", actorEmail: "a@x.io" }),
					row(5, { source: "portal", actorId: "system", actorEmail: "system" }),
				],
				nextCursor: null,
			},
		],
	});
	await until(() => ui.getByText("res-1"));
	expect(ui.getByText("p@x.io")).toBeTruthy();
	expect(ui.getByText("via MCP by m@x.io")).toBeTruthy();
	expect(ui.getByText("via PAT by t@x.io")).toBeTruthy();
	expect(ui.getByText("via agent by a@x.io")).toBeTruthy();
	expect(ui.getByText("System")).toBeTruthy();
});

test("shows the time in local time with the exact ISO time on hover", async () => {
	const { ui } = setup();
	await until(() => ui.getByText("res-1"));
	const time = document.querySelector("time")!;
	expect(time.getAttribute("title")).toBe("2026-10-17T10:00:00.000Z");
	expect(time.textContent).toMatch(/17 Oct 2026/);
});

test("shows a message when a row has one, and flags a failure", async () => {
	const { ui } = setup({
		pages: [
			{ data: [row(1, { message: "rolled back", status: "failure" }), row(2)], nextCursor: null },
		],
	});
	expect(await until(() => ui.getByText("rolled back"))).toBeTruthy();
	expect(ui.getByText("Failed")).toBeTruthy();
});

test("keeps a deleted project's name and marks it deleted", async () => {
	const { ui } = setup({
		pages: [
			{
				data: [row(1, { projectId: "gone", projectName: "Old Shop", projectDeleted: true })],
				nextCursor: null,
			},
		],
	});
	expect((await until(() => ui.getAllByText("Old Shop"))).length).toBeGreaterThan(0);
	expect(ui.getByText("Deleted")).toBeTruthy();
});

test("?project= pre-selects the project filter, also for a deleted project", async () => {
	const { list, ui } = setup({ project: "gone" });
	await until(() => ui.getByText("res-1"));
	expect(list.mock.calls[0]![0]).toMatchObject({ projectId: "gone" });
	await until(() => expect(ui.getAllByText("Old Shop (deleted)").length).toBeGreaterThan(0));
});

test("clearing the filters drops the project from the URL", async () => {
	const { onProjectChange, ui } = setup({ project: "p1" });
	await until(() => ui.getByText("res-1"));
	fireEvent.click(ui.getByText("Clear filters"));
	expect(onProjectChange).toHaveBeenCalledWith(undefined);
});

test("loads the next page with the cursor", async () => {
	const { list, ui } = setup({
		pages: [
			{ data: [row(1)], nextCursor: "c1" },
			{ data: [row(2)], nextCursor: null },
		],
	});
	await until(() => ui.getByText("res-1"));
	fireEvent.click(ui.getByText("Load more"));
	expect(await until(() => ui.getByText("res-2"))).toBeTruthy();
	expect(list.mock.calls[1]![1]).toBe("c1");
	expect(ui.getByText("res-1")).toBeTruthy();
	expect(ui.queryByText("Load more")).toBeNull();
});

test("says so when there are no events, and when the filters match none", async () => {
	const empty = setup({ pages: [{ data: [], nextCursor: null }] });
	expect(await until(() => empty.ui.getByText("No events yet"))).toBeTruthy();
	cleanup();
	const filtered = setup({ pages: [{ data: [], nextCursor: null }], project: "p1" });
	expect(await until(() => filtered.ui.getByText("No events match these filters"))).toBeTruthy();
});

test("offers a retry when the list cannot be loaded", async () => {
	license(["auditLogs"]);
	const list = spyOn(auditLogsService, "list").mockRejectedValueOnce(new Error("boom"));
	spyOn(auditLogsService, "filters").mockResolvedValue(options);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<AuditLogSettings onProjectChange={mock()} />
		</QueryClientProvider>,
	);
	const ui = within(document.body);
	expect(await until(() => ui.getByText("Couldn't load the audit logs."))).toBeTruthy();
	list.mockResolvedValue({ data: [row(1)], nextCursor: null });
	fireEvent.click(ui.getByText("Try again"));
	expect(await until(() => ui.getByText("res-1"))).toBeTruthy();
});

test("opens the whole event, with every changed field and the message", async () => {
	const { ui } = setup({
		pages: [
			{
				data: [row(1, { changedFields: ["a", "b", "c", "d"], message: "full text here" })],
				nextCursor: null,
			},
		],
	});
	await until(() => ui.getByText("res-1"));
	fireEvent.click(ui.getByLabelText("Details of update route"));
	const dialog = await until(() => ui.getByRole("dialog"));
	expect(within(dialog).getByText("d")).toBeTruthy();
	expect(within(dialog).getByText("full text here")).toBeTruthy();
});

test("is locked, and asks for nothing, without the audit logs licence", async () => {
	const { list, ui } = setup({ features: ["connectors"] });
	expect(await until(() => ui.getByText("Enterprise only"))).toBeTruthy();
	expect(ui.queryByText("res-1")).toBeNull();
	expect(list).not.toHaveBeenCalled();
});
