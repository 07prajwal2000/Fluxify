import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

const { useState } = await import("react");
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { knowledgeSourcesService } = await import("@/services/knowledgeSources");
const { appConfigService } = await import("@/services/appConfig");
const { KnowledgeBasePanel } = await import("./KnowledgeBasePanel");

async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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

const listSpy = spyOn(knowledgeSourcesService, "list");
const getSpy = spyOn(knowledgeSourcesService, "get");
const createSpy = spyOn(knowledgeSourcesService, "create");
const updateSpy = spyOn(knowledgeSourcesService, "update");
const updatePageSpy = spyOn(knowledgeSourcesService, "updatePage");
const refetchSpy = spyOn(knowledgeSourcesService, "refetch");
const removeSpy = spyOn(knowledgeSourcesService, "remove");
const previewSpy = spyOn(knowledgeSourcesService, "previewLlms");
const appConfigSpy = spyOn(appConfigService, "getAll");

beforeEach(() => {
	listSpy.mockReset().mockResolvedValue([]);
	getSpy.mockReset().mockResolvedValue({
		id: "src-1",
		name: "existing-source",
		type: "url",
		url: "https://example.com/docs",
		headers: {},
		selectedPages: [],
		enabled: true,
		pageCount: 1,
		lastFetchedAt: "2026-10-16T12:00:00Z",
		lastFetchStatus: "ok",
		lastFetchError: null,
		pages: [{ url: "https://example.com/docs", markdown: "# Hello from docs" }],
	});
	createSpy.mockReset().mockResolvedValue({ id: "src-new" });
	updateSpy.mockReset().mockResolvedValue({ id: "src-1" });
	updatePageSpy.mockReset().mockResolvedValue({ id: "src-1" });
	refetchSpy.mockReset().mockResolvedValue({
		id: "src-1",
		name: "existing-source",
		type: "url",
		url: "https://example.com/docs",
		headers: {},
		selectedPages: [],
		enabled: true,
		pageCount: 1,
		lastFetchedAt: "2026-10-16T12:05:00Z",
		lastFetchStatus: "ok",
		lastFetchError: null,
		pages: [{ url: "https://example.com/docs", markdown: "# Updated docs" }],
	});
	removeSpy.mockReset().mockResolvedValue({ id: "src-1" });
	previewSpy.mockReset().mockResolvedValue({
		pages: [
			{ title: "Introduction", url: "https://example.com/docs/intro" },
			{ title: "API Reference", url: "https://example.com/docs/api" },
			{ title: "Authentication", url: "https://example.com/docs/auth" },
		],
	});
	appConfigSpy.mockReset().mockResolvedValue({
		data: [{ id: 1, keyName: "API_SECRET" } as any],
		pagination: { page: 1, totalPages: 1, hasNext: false },
	});
});

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function TestHost() {
	const [selected, setSelected] = useState<string | null>(null);
	const [isAdding, setIsAdding] = useState(false);

	return (
		<KnowledgeBasePanel
			projectId="p1"
			selectedSourceId={selected}
			isAdding={isAdding}
			onSelectSource={setSelected}
			onSetIsAdding={setIsAdding}
		/>
	);
}

function setup(role: "viewer" | "creator" | "project_admin") {
	authStore
		.getState()
		.actions.setUserData({ id: "u1", name: "User", email: "u@fluxify.io", isSystemAdmin: false });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);

	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<TestHost />
		</QueryClientProvider>,
	);
}

const findButton = (text: string, root: ParentNode = document) =>
	[...root.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

test("add-source flow with llms.txt: previews pages, filters with page picker, and creates source", async () => {
	const { container } = setup("creator");

	// Wait for sidebar and click "Add source"
	const addBtn = await until(() => {
		const b = findButton("Add source", container);
		if (!b) throw new Error("Add source button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(addBtn);
	});

	// Open Source Type Dropdown
	const dropdownTrigger = await until(() => {
		const btns = [...container.querySelectorAll("button")];
		const target = btns.find((b) => b.textContent?.includes("Hand-written Markdown"));
		if (!target) throw new Error("Dropdown trigger not found");
		return target;
	});

	await act(() => {
		fireEvent.click(dropdownTrigger);
	});

	// Select llms.txt option in dropdown popover
	const llmsOption = await until(() => {
		const btns = [...container.querySelectorAll("button")];
		const target = btns.find((b) => b.textContent?.includes("llms.txt"));
		if (!target) throw new Error("llms.txt option not found");
		return target;
	});

	await act(() => {
		fireEvent.click(llmsOption);
	});

	// Fill name input
	const nameInput = container.querySelector(
		'input[placeholder*="stripe-api-docs"]',
	) as HTMLInputElement;
	expect(nameInput).toBeTruthy();
	await act(() => {
		fireEvent.change(nameInput, { target: { value: "test-llms-source" } });
	});

	// Fill URL input
	const urlInput = container.querySelector('input[placeholder*="llms.txt"]') as HTMLInputElement;
	expect(urlInput).toBeTruthy();
	await act(() => {
		fireEvent.change(urlInput, { target: { value: "https://example.com/llms.txt" } });
	});

	// Click "Fetch pages"
	const fetchPagesBtn = findButton("Fetch pages", container);
	expect(fetchPagesBtn).toBeTruthy();
	await act(() => {
		fireEvent.click(fetchPagesBtn!);
	});

	// Verify previewSpy called with url
	await until(() => {
		expect(previewSpy).toHaveBeenCalledTimes(1);
		expect(previewSpy.mock.calls[0][1]).toEqual({
			url: "https://example.com/llms.txt",
			headers: {},
		});
	});

	// Verify PagePicker rendered the preview pages
	await until(() => {
		const text = container.textContent || "";
		expect(text).toContain("Introduction");
		expect(text).toContain("API Reference");
		expect(text).toContain("Authentication");
	});

	// Filter pages
	const filterInput = container.querySelector(
		'input[placeholder*="Filter pages"]',
	) as HTMLInputElement;
	expect(filterInput).toBeTruthy();
	await act(() => {
		fireEvent.change(filterInput, { target: { value: "Auth" } });
	});

	expect(container.textContent).toContain("Authentication");
	expect(container.textContent).not.toContain("Introduction");

	// Clear filter
	await act(() => {
		fireEvent.change(filterInput, { target: { value: "" } });
	});

	// Click "Create source"
	const createBtn = findButton("Create source", container);
	expect(createBtn).toBeTruthy();
	await act(() => {
		fireEvent.click(createBtn!);
	});

	// Verify createSpy called
	await until(() => {
		expect(createSpy).toHaveBeenCalledTimes(1);
		const call = createSpy.mock.calls[0];
		expect(call[0]).toBe("p1");
		expect(call[1].name).toBe("test-llms-source");
		expect(call[1].type).toBe("llms_txt");
		expect(call[1].url).toBe("https://example.com/llms.txt");
		expect(call[1].selectedPages).toContain("https://example.com/docs/intro");
	});
});

test("viewer role sees read-only state: Add source button is hidden", async () => {
	listSpy.mockResolvedValueOnce([
		{
			id: "s1",
			name: "doc-source",
			type: "markdown",
			url: null,
			headers: {},
			selectedPages: [],
			enabled: true,
			pageCount: 1,
			lastFetchedAt: null,
			lastFetchStatus: null,
			lastFetchError: null,
		},
	]);

	const { container } = setup("viewer");

	await until(() => {
		expect(container.textContent).toContain("doc-source");
	});

	// Add source button should not be rendered
	const addBtn = findButton("Add source", container);
	expect(addBtn).toBeFalsy();

	// Delete and Re-fetch buttons should not be rendered for viewer
	expect(findButton("Delete", container)).toBeFalsy();
	expect(findButton("Re-fetch", container)).toBeFalsy();
});

test("displays validation errors clearly when creation fails", async () => {
	createSpy.mockRejectedValueOnce(
		Object.assign(new Error("Only http(s) URLs can be fetched: ftp://bad"), {
			isAxiosError: true,
			response: {
				status: 400,
				data: { message: "Only http(s) URLs can be fetched: ftp://bad" },
			},
		}),
	);

	const { container } = setup("creator");

	const addBtn = await until(() => {
		const b = findButton("Add source", container);
		if (!b) throw new Error("Add source button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(addBtn);
	});

	// Open dropdown
	const dropdownTrigger = await until(() => {
		const btns = [...container.querySelectorAll("button")];
		const target = btns.find((b) => b.textContent?.includes("Hand-written Markdown"));
		if (!target) throw new Error("Dropdown trigger not found");
		return target;
	});
	await act(() => {
		fireEvent.click(dropdownTrigger);
	});

	// Pick URL type from dropdown
	const urlOption = await until(() => {
		const btns = [...container.querySelectorAll("button")];
		const target = btns.find((b) => b.textContent?.includes("HTML / Markdown URL"));
		if (!target) throw new Error("URL option not found");
		return target;
	});
	await act(() => {
		fireEvent.click(urlOption);
	});

	// Fill name and url
	const nameInput = container.querySelector(
		'input[placeholder*="stripe-api-docs"]',
	) as HTMLInputElement;
	await act(() => {
		fireEvent.change(nameInput, { target: { value: "bad-url-src" } });
	});

	const urlInput = container.querySelector(
		'input[placeholder*="docs.example.com"]',
	) as HTMLInputElement;
	await act(() => {
		fireEvent.change(urlInput, { target: { value: "https://example.com/bad" } });
	});

	// Click Create source
	const createBtn = findButton("Create source", container);
	await act(() => {
		fireEvent.click(createBtn!);
	});

	// Error alert should be displayed
	await until(() => {
		expect(container.textContent).toContain("Only http(s) URLs can be fetched: ftp://bad");
	});
});

test("add-source flow with hand-written markdown creates source with DocsEditor content", async () => {
	const { container } = setup("creator");

	const addBtn = await until(() => {
		const b = findButton("Add source", container);
		if (!b) throw new Error("Add source button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(addBtn);
	});

	// Hand-written Markdown is selected by default in the dropdown
	const nameInput = container.querySelector(
		'input[placeholder*="stripe-api-docs"]',
	) as HTMLInputElement;
	await act(() => {
		fireEvent.change(nameInput, { target: { value: "project-manual" } });
	});

	const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
	expect(textarea).toBeTruthy();
	await act(() => {
		fireEvent.change(textarea, { target: { value: "# Manual\n\nThis is the project manual." } });
	});

	const createBtn = findButton("Create source", container);
	await act(() => {
		fireEvent.click(createBtn!);
	});

	await until(() => {
		expect(createSpy).toHaveBeenCalledTimes(1);
		const call = createSpy.mock.calls[0];
		expect(call[0]).toBe("p1");
		expect(call[1].name).toBe("project-manual");
		expect(call[1].type).toBe("markdown");
		expect(call[1].content).toBe("# Manual\n\nThis is the project manual.");
	});
});

test("confirm delete removes the popup and clears the preview screen", async () => {
	listSpy.mockResolvedValue([
		{
			id: "src-1",
			name: "to-delete-source",
			type: "url",
			url: "https://example.com",
			headers: {},
			selectedPages: [],
			enabled: true,
			pageCount: 1,
			lastFetchedAt: null,
			lastFetchStatus: null,
			lastFetchError: null,
		},
	]);

	const { container } = setup("creator");

	// Click on source in sidebar
	const sourceItem = await until(() => {
		const b = findButton("to-delete-source", container);
		if (!b) throw new Error("Source item not found in sidebar");
		return b;
	});

	await act(() => {
		fireEvent.click(sourceItem);
	});

	// Wait for detail pane to load
	const deleteBtn = await until(() => {
		const b = findButton("Delete", container);
		if (!b) throw new Error("Delete button not found");
		return b;
	});

	// Open delete confirm dialog
	await act(() => {
		fireEvent.click(deleteBtn);
	});

	// Click Confirm Delete in modal dialog
	const confirmModalDelete = await until(() => {
		const dialog = document.querySelector('[role="dialog"]');
		if (!dialog) throw new Error("Modal dialog not found");
		const btns = [...dialog.querySelectorAll("button")];
		const b = btns.find((btn) => btn.textContent?.includes("Delete"));
		if (!b) throw new Error("Modal Delete button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(confirmModalDelete);
	});

	// Verify removeSpy was called
	await until(() => {
		expect(removeSpy).toHaveBeenCalledTimes(1);
		expect(removeSpy.mock.calls[0][0]).toBe("p1");
		expect(removeSpy.mock.calls[0][1]).toBe("src-1");
	});

	// Verify preview screen cleared to "No source selected"
	await until(() => {
		expect(container.textContent).toContain("No source selected");
	});
});

test("page editing flow: edits a page, saves it, and calls updatePage", async () => {
	listSpy.mockResolvedValue([
		{
			id: "src-1",
			name: "fetched-source",
			type: "url",
			url: "https://example.com/docs",
			headers: {},
			selectedPages: [],
			enabled: true,
			pageCount: 1,
			lastFetchedAt: "2026-10-16T12:00:00Z",
			lastFetchStatus: "ok",
			lastFetchError: null,
		},
	]);
	getSpy.mockResolvedValue({
		id: "src-1",
		name: "fetched-source",
		type: "url",
		url: "https://example.com/docs",
		headers: {},
		selectedPages: [],
		enabled: true,
		pageCount: 1,
		editedCount: 0,
		lastFetchedAt: "2026-10-16T12:00:00Z",
		lastFetchStatus: "ok",
		lastFetchError: null,
		pages: [{ url: "https://example.com/docs", markdown: "# Initial content" }],
	});

	const { container } = setup("creator");

	const sourceItem = await until(() => {
		const b = findButton("fetched-source", container);
		if (!b) throw new Error("Source item not found in sidebar");
		return b;
	});

	await act(() => {
		fireEvent.click(sourceItem);
	});

	// Find "Edit page" button
	const editPageBtn = await until(() => {
		const b = findButton("Edit page", container);
		if (!b) throw new Error("Edit page button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(editPageBtn);
	});

	// Find the textarea in DocsEditor and change its content
	const textarea = await until(() => {
		const ta = container.querySelector("textarea");
		if (!ta) throw new Error("DocsEditor textarea not found");
		return ta;
	});

	await act(() => {
		fireEvent.change(textarea, { target: { value: "# Updated page content" } });
	});

	// Click "Save"
	const saveBtn = await until(() => {
		const b = findButton("Save", container);
		if (!b) throw new Error("Save button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(saveBtn);
	});

	await until(() => {
		expect(updatePageSpy).toHaveBeenCalledTimes(1);
		expect(updatePageSpy.mock.calls[0][0]).toBe("p1");
		expect(updatePageSpy.mock.calls[0][1]).toBe("src-1");
		expect(updatePageSpy.mock.calls[0][2]).toBe(0);
		expect(updatePageSpy.mock.calls[0][3]).toEqual({ markdown: "# Updated page content" });
	});
});

test("re-fetch button shows confirmation dialog when source has edited pages", async () => {
	listSpy.mockResolvedValue([
		{
			id: "src-1",
			name: "edited-source",
			type: "url",
			url: "https://example.com/docs",
			headers: {},
			selectedPages: [],
			enabled: true,
			pageCount: 1,
			editedCount: 1,
			lastFetchedAt: "2026-10-16T12:00:00Z",
			lastFetchStatus: "ok",
			lastFetchError: null,
		},
	]);
	getSpy.mockResolvedValue({
		id: "src-1",
		name: "edited-source",
		type: "url",
		url: "https://example.com/docs",
		headers: {},
		selectedPages: [],
		enabled: true,
		pageCount: 1,
		editedCount: 1,
		lastFetchedAt: "2026-10-16T12:00:00Z",
		lastFetchStatus: "ok",
		lastFetchError: null,
		pages: [{ url: "https://example.com/docs", markdown: "# Hand edited", edited: true }],
	});

	const { container } = setup("creator");

	const sourceItem = await until(() => {
		const b = findButton("edited-source", container);
		if (!b) throw new Error("Source item not found in sidebar");
		return b;
	});

	await act(() => {
		fireEvent.click(sourceItem);
	});

	// Find Re-fetch button
	const refetchBtn = await until(() => {
		const b = findButton("Re-fetch", container);
		if (!b) throw new Error("Re-fetch button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(refetchBtn);
	});

	// Confirmation modal dialog should appear warning about replacing edited pages
	const confirmModalBtn = await until(() => {
		const dialog = document.querySelector('[role="dialog"]');
		if (!dialog) throw new Error("Modal dialog not found");
		expect(dialog.textContent).toContain("Re-fetching replaces 1 edited page");
		const btns = [...dialog.querySelectorAll("button")];
		const b = btns.find((btn) => btn.textContent?.includes("Re-fetch"));
		if (!b) throw new Error("Modal Re-fetch button not found");
		return b;
	});

	await act(() => {
		fireEvent.click(confirmModalBtn);
	});

	await until(() => {
		expect(refetchSpy).toHaveBeenCalledTimes(1);
		expect(refetchSpy.mock.calls[0][0]).toBe("p1");
		expect(refetchSpy.mock.calls[0][1]).toBe("src-1");
	});
});
