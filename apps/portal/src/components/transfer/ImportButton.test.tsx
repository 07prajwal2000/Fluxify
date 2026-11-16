import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the page owns navigation: the button only hands the new id to onOpen
const onOpen = mock((_: string) => {});

// no real file picker in a test process; the rest of the module stays real
// copies: Bun patches a mocked module in place, so the namespace itself would turn into the stub
// only the picker is replaced: it hands back a real bundle file, and the real reader parses it
const actual = { ...(await import("./transferFile")) };
const bundleJson = JSON.stringify({
	kind: "fluxify.route",
	route: { name: "Get Active Employees", path: "/employees/active", method: "GET" },
	canvas: { blocks: [], edges: [] },
});
const workflowJson = JSON.stringify({
	kind: "fluxify.workflow",
	workflow: { name: "Nightly digest" },
	canvas: { blocks: [], edges: [] },
});
// which file the picker hands back; workflow tests switch it
let pickedFile = () => new File([bundleJson], "r.fluxroute");
mock.module("./transferFile", () => ({
	...actual,
	pickBundleFile: async () => pickedFile(),
}));
// the read-only canvas is ReactFlow, which this feature's tests have no need to draw
const previewActual = { ...(await import("./BundlePreview")) };
mock.module("./BundlePreview", () => ({
	BundlePreview: () => <div>canvas preview</div>,
}));

const { AxiosError } = await import("axios");
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ImportButton } = await import("./ImportButton");
const { transferService } = await import("@/services/transfer");

afterEach(cleanup);
afterAll(() => {
	GlobalRegistrator.unregister();
	// the registry is process-wide: hand the real modules back to the files that run next
	mock.module("./BundlePreview", () => previewActual);
	mock.module("./transferFile", () => actual);
});
beforeEach(() => {
	mock.restore();
	// nothing is taken unless a test says so
	spyOn(transferService, "checkImport").mockResolvedValue({ taken: [] });
	onOpen.mockClear();
	pickedFile = () => new File([bundleJson], "r.fluxroute");
});

// RTL stays bound to the first file's document in a shared test process, so the
// dialog is looked up through the document the render itself landed in
let body: HTMLElement = document.body;
const screen = () => within(body);
const renderButton = (resourceType: "route" | "workflow" = "route") => {
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<ImportButton resourceType={resourceType} projectId="p1" onOpen={onOpen} />
		</QueryClientProvider>,
	);
	body = view.baseElement.ownerDocument.body;
	return view;
};

// the file is read and the dialog opens after the click: flush both inside act
const pickFile = () =>
	act(async () => {
		fireEvent.click(screen().getByText("Import"));
	});
// the dialog's own Import button comes after the page's
const confirm = () =>
	act(async () => {
		fireEvent.click(screen().getAllByText("Import").at(-1) as HTMLElement);
	});
const field = (label: string) => screen().getByLabelText(label) as HTMLInputElement;
const imported = (spy: ReturnType<typeof spyOn>) =>
	(spy.mock.calls[0]?.[2] as { route: { name: string; path: string } }).route;

test("asks before importing, and shows what is in the route", async () => {
	const importSpy = spyOn(transferService, "import").mockResolvedValue({
		id: "new1",
		warnings: [],
	});
	renderButton();

	await pickFile();

	await waitFor(() => expect(screen().getByText("Import this route?")).toBeTruthy());
	expect(screen().getByText("canvas preview")).toBeTruthy();
	expect(importSpy).not.toHaveBeenCalled();
	expect(onOpen).not.toHaveBeenCalled();
});

test("keeps the name and path, with no warning, when nothing is taken", async () => {
	const importSpy = spyOn(transferService, "import").mockResolvedValue({
		id: "new1",
		warnings: [],
	});
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name").value).toBe("Get Active Employees"));
	expect(field("Path").value).toBe("/employees/active");
	expect(screen().queryByText(/already exist/)).toBeNull();
	await confirm();

	await waitFor(() => expect(onOpen).toHaveBeenCalledWith("new1"));
	expect(imported(importSpy)).toMatchObject({
		name: "Get Active Employees",
		path: "/employees/active",
	});
});

test("adds -copy to what is taken and warns about it when the dialog opens", async () => {
	spyOn(transferService, "checkImport").mockResolvedValue({ taken: ["name", "path"] });
	const importSpy = spyOn(transferService, "import").mockResolvedValue({
		id: "new1",
		warnings: [],
	});
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name").value).toBe("Get Active Employees-copy"));
	expect(field("Path").value).toBe("/employees/active-copy");
	expect(screen().getByText(/already exist in this project.*imported as a copy/)).toBeTruthy();
	await confirm();

	await waitFor(() => expect(onOpen).toHaveBeenCalledWith("new1"));
	expect(imported(importSpy)).toMatchObject({
		name: "Get Active Employees-copy",
		path: "/employees/active-copy",
	});
});

test("renames only the path when only the path is taken, and the warning goes once edited", async () => {
	spyOn(transferService, "checkImport").mockResolvedValue({ taken: ["path"] });
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Path").value).toBe("/employees/active-copy"));
	expect(field("Name").value).toBe("Get Active Employees");
	expect(screen().getByText(/GET \/employees\/active already exists/)).toBeTruthy();

	fireEvent.change(field("Path"), { target: { value: "/staff" } });
	expect(screen().queryByText(/already exists/)).toBeNull();
});

test("creates nothing when the user cancels", async () => {
	const importSpy = spyOn(transferService, "import").mockResolvedValue({
		id: "new1",
		warnings: [],
	});
	renderButton();

	await pickFile();
	await waitFor(() => expect(screen().getByText("Import this route?")).toBeTruthy());
	fireEvent.click(screen().getByText("Cancel"));

	expect(importSpy).not.toHaveBeenCalled();
	expect(onOpen).not.toHaveBeenCalled();
});

test("shows what was left out before opening the route", async () => {
	spyOn(transferService, "import").mockResolvedValue({
		id: "new1",
		warnings: ['Middleware "auth" doesn\'t exist in this project and was not attached.'],
	});
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name")).toBeTruthy());
	await confirm();

	await waitFor(() => expect(screen().getByText(/Middleware "auth"/)).toBeTruthy());
	expect(onOpen).not.toHaveBeenCalled();
	fireEvent.click(screen().getByText("Open route"));
	expect(onOpen).toHaveBeenCalledWith("new1");
});

test("keeps the dialog open on a name or path clash, so both can be changed", async () => {
	const clash = new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
		status: 409,
		data: { message: 'A route named "Get Active Employees" already exists in this project.' },
	} as never);
	const importSpy = spyOn(transferService, "import")
		.mockRejectedValueOnce(clash)
		.mockResolvedValueOnce({ id: "new1", warnings: [] });
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name")).toBeTruthy());
	await confirm();
	await waitFor(() => expect(screen().getByText(/already exists in this project/)).toBeTruthy());
	expect(onOpen).not.toHaveBeenCalled();

	fireEvent.change(field("Name"), { target: { value: "Get Staff" } });
	fireEvent.change(field("Path"), { target: { value: "/staff" } });
	await confirm();

	await waitFor(() => expect(onOpen).toHaveBeenCalledWith("new1"));
	expect(importSpy.mock.calls[1]?.[2]).toMatchObject({
		route: { name: "Get Staff", path: "/staff" },
	});
});

test("stays put when the server refuses the file", async () => {
	spyOn(transferService, "import").mockRejectedValue(new Error("not a route export"));
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name")).toBeTruthy());
	await confirm();

	await waitFor(() => expect(transferService.import).toHaveBeenCalled());
	expect(onOpen).not.toHaveBeenCalled();
});

test("refuses a workflow file on the routes page", async () => {
	const workflowFile = new File(
		[
			JSON.stringify({
				kind: "fluxify.workflow",
				workflow: { name: "w" },
				canvas: { blocks: [], edges: [] },
			}),
		],
		"w.fluxworkflow",
	);
	await expect(actual.readBundleFile(workflowFile, "route")).rejects.toThrow(
		"That file isn't a Fluxify route export.",
	);
});

const renderWorkflowButton = () => {
	pickedFile = () => new File([workflowJson], "w.fluxworkflow");
	return renderButton("workflow");
};

test("imports a workflow and opens its canvas", async () => {
	const importSpy = spyOn(transferService, "import").mockResolvedValue({
		id: "wf1",
		warnings: [],
	});
	renderWorkflowButton();

	await pickFile();
	await waitFor(() => expect(field("Name").value).toBe("Nightly digest"));
	expect(screen().queryByLabelText("Path")).toBeNull();
	await confirm();

	await waitFor(() => expect(onOpen).toHaveBeenCalledWith("wf1"));
	expect(importSpy.mock.calls[0]?.[2]).toMatchObject({ workflow: { name: "Nightly digest" } });
});

test("prefills a taken workflow name as a copy", async () => {
	spyOn(transferService, "checkImport").mockResolvedValue({ taken: ["name"] });
	renderWorkflowButton();

	await pickFile();
	await waitFor(() => expect(field("Name").value).toBe("Nightly digest-copy"));
	expect(screen().getByText(/a workflow named "Nightly digest" already exists/)).toBeTruthy();
});

test("keeps the workflow dialog open on a 409", async () => {
	const clash = new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
		status: 409,
		data: { message: 'A workflow named "Nightly digest" already exists in this project.' },
	} as never);
	spyOn(transferService, "import").mockRejectedValue(clash);
	renderWorkflowButton();

	await pickFile();
	await waitFor(() => expect(field("Name")).toBeTruthy());
	await confirm();

	await waitFor(() => expect(screen().getByText(/A workflow named/)).toBeTruthy());
	expect(field("Name").value).toBe("Nightly digest");
	expect(onOpen).not.toHaveBeenCalled();
});
