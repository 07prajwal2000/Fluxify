import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const navigate = mock((_: unknown) => {});
const router = await import("@tanstack/react-router");
// the button navigates to the new route
mock.module("@tanstack/react-router", () => ({ ...router, useNavigate: () => navigate }));

// no real file picker in a test process; the rest of the module stays real
let sourceProjectId = "other";
// copies: Bun patches a mocked module in place, so the namespace itself would turn into the stub
const actual = { ...(await import("./routeFile")) };
mock.module("./routeFile", () => ({
	...actual,
	pickRouteFile: async () => new File(["{}"], "r.fluxroute"),
	readRouteFile: async () => ({
		kind: "fluxify.route",
		sourceProjectId,
		route: { name: "Get Active Employees", path: "/employees/active" },
		canvas: { blocks: [], edges: [] },
	}),
}));
// the read-only canvas is ReactFlow, which this feature's tests have no need to draw
const previewActual = { ...(await import("./RouteBundlePreview")) };
mock.module("./RouteBundlePreview", () => ({
	RouteBundlePreview: () => <div>canvas preview</div>,
}));

const { AxiosError } = await import("axios");
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ImportRouteButton } = await import("./ImportRouteButton");
const { routesService } = await import("@/services/routes");

afterEach(cleanup);
afterAll(() => {
	GlobalRegistrator.unregister();
	// the registry is process-wide: hand the real modules back to the files that run next
	mock.module("./RouteBundlePreview", () => previewActual);
	mock.module("./routeFile", () => actual);
});
beforeEach(() => {
	mock.restore();
	navigate.mockClear();
	sourceProjectId = "other";
});

// RTL stays bound to the first file's document in a shared test process, so the
// dialog is looked up through the document the render itself landed in
let body: HTMLElement = document.body;
const screen = () => within(body);
const renderButton = () => {
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<ImportRouteButton projectId="p1" />
		</QueryClientProvider>,
	);
	body = view.baseElement.ownerDocument.body;
	return view;
};
const toCanvas = {
	to: "/$projectId/canvas/$routeId",
	params: { projectId: "p1", routeId: "new1" },
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
	(spy.mock.calls[0]?.[1] as { route: { name: string; path: string } }).route;

test("asks before importing, and shows what is in the route", async () => {
	const importSpy = spyOn(routesService, "import").mockResolvedValue({ id: "new1", warnings: [] });
	renderButton();

	await pickFile();

	await waitFor(() => expect(screen().getByText("Import this route?")).toBeTruthy());
	expect(screen().getByText("canvas preview")).toBeTruthy();
	expect(importSpy).not.toHaveBeenCalled();
	expect(navigate).not.toHaveBeenCalled();
});

test("keeps the name and path when importing into another project", async () => {
	const importSpy = spyOn(routesService, "import").mockResolvedValue({ id: "new1", warnings: [] });
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name").value).toBe("Get Active Employees"));
	expect(field("Path").value).toBe("/employees/active");
	await confirm();

	await waitFor(() => expect(navigate).toHaveBeenCalledWith(toCanvas));
	expect(imported(importSpy)).toEqual({ name: "Get Active Employees", path: "/employees/active" });
});

test("adds -copy by default when importing into the project it came from", async () => {
	sourceProjectId = "p1";
	const importSpy = spyOn(routesService, "import").mockResolvedValue({ id: "new1", warnings: [] });
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name").value).toBe("Get Active Employees-copy"));
	expect(field("Path").value).toBe("/employees/active-copy");
	await confirm();

	await waitFor(() => expect(navigate).toHaveBeenCalledWith(toCanvas));
	expect(imported(importSpy).name).toBe("Get Active Employees-copy");
});

test("creates nothing when the user cancels", async () => {
	const importSpy = spyOn(routesService, "import").mockResolvedValue({ id: "new1", warnings: [] });
	renderButton();

	await pickFile();
	await waitFor(() => expect(screen().getByText("Import this route?")).toBeTruthy());
	fireEvent.click(screen().getByText("Cancel"));

	expect(importSpy).not.toHaveBeenCalled();
	expect(navigate).not.toHaveBeenCalled();
});

test("shows what was left out before opening the route", async () => {
	spyOn(routesService, "import").mockResolvedValue({
		id: "new1",
		warnings: ['Middleware "auth" doesn\'t exist in this project and was not attached.'],
	});
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name")).toBeTruthy());
	await confirm();

	await waitFor(() => expect(screen().getByText(/Middleware "auth"/)).toBeTruthy());
	expect(navigate).not.toHaveBeenCalled();
	fireEvent.click(screen().getByText("Open route"));
	expect(navigate).toHaveBeenCalledWith(toCanvas);
});

test("keeps the dialog open on a name or path clash, so both can be changed", async () => {
	const clash = new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
		status: 409,
		data: { message: 'A route named "Get Active Employees" already exists in this project.' },
	} as never);
	const importSpy = spyOn(routesService, "import")
		.mockRejectedValueOnce(clash)
		.mockResolvedValueOnce({ id: "new1", warnings: [] });
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name")).toBeTruthy());
	await confirm();
	await waitFor(() => expect(screen().getByText(/already exists in this project/)).toBeTruthy());
	expect(navigate).not.toHaveBeenCalled();

	fireEvent.change(field("Name"), { target: { value: "Get Staff" } });
	fireEvent.change(field("Path"), { target: { value: "/staff" } });
	await confirm();

	await waitFor(() => expect(navigate).toHaveBeenCalledWith(toCanvas));
	expect(importSpy.mock.calls[1]?.[1]).toMatchObject({
		route: { name: "Get Staff", path: "/staff" },
	});
});

test("stays put when the server refuses the file", async () => {
	spyOn(routesService, "import").mockRejectedValue(new Error("not a route export"));
	renderButton();

	await pickFile();
	await waitFor(() => expect(field("Name")).toBeTruthy());
	await confirm();

	await waitFor(() => expect(routesService.import).toHaveBeenCalled());
	expect(navigate).not.toHaveBeenCalled();
});
