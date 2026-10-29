import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const navigate = mock((_: unknown) => {});
const router = await import("@tanstack/react-router");
// the button navigates to the new route
mock.module("@tanstack/react-router", () => ({ ...router, useNavigate: () => navigate }));

// no real file picker in a test process; the rest of the module stays real
const actual = await import("./routeFile");
mock.module("./routeFile", () => ({
	...actual,
	pickRouteFile: async () => new File(["{}"], "r.fluxroute"),
	readRouteFile: async () => ({
		kind: "fluxify.route",
		route: { name: "Get Active Employees", path: "/employees/active" },
	}),
}));

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { AxiosError } = await import("axios");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ImportRouteButton } = await import("./ImportRouteButton");
const { routesService } = await import("@/services/routes");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
	mock.restore();
	navigate.mockClear();
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

test("opens the new route when nothing was left out", async () => {
	spyOn(routesService, "import").mockResolvedValue({ id: "new1", warnings: [] });
	renderButton();

	fireEvent.click(screen().getByText("Import"));

	await waitFor(() => expect(navigate).toHaveBeenCalledWith(toCanvas));
});

test("shows what was left out before opening the route", async () => {
	spyOn(routesService, "import").mockResolvedValue({
		id: "new1",
		warnings: ['Middleware "auth" doesn\'t exist in this project and was not attached.'],
	});
	renderButton();

	// the import settles after the click: flush it, and the dialog it opens, inside act
	await act(async () => {
		fireEvent.click(screen().getByText("Import"));
	});

	await waitFor(() => expect(screen().getByText(/Middleware "auth"/)).toBeTruthy());
	expect(navigate).not.toHaveBeenCalled();
	fireEvent.click(screen().getByText("Open route"));
	expect(navigate).toHaveBeenCalledWith(toCanvas);
});

test("stays put when the server refuses the file", async () => {
	spyOn(routesService, "import").mockRejectedValue(new Error("name taken"));
	renderButton();

	fireEvent.click(screen().getByText("Import"));

	await waitFor(() => expect(routesService.import).toHaveBeenCalled());
	expect(navigate).not.toHaveBeenCalled();
});

test("asks for a new name and path when the route already exists, then imports it", async () => {
	const clash = new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
		status: 409,
		data: { message: 'A route named "Get Active Employees" already exists in this project.' },
	} as never);
	const importSpy = spyOn(routesService, "import")
		.mockRejectedValueOnce(clash)
		.mockResolvedValueOnce({ id: "new1", warnings: [] });
	renderButton();

	await act(async () => {
		fireEvent.click(screen().getByText("Import"));
	});
	await waitFor(() => expect(screen().getByText(/already exists in this project/)).toBeTruthy());
	expect(navigate).not.toHaveBeenCalled();

	fireEvent.change(screen().getByLabelText("Name"), { target: { value: "Get Staff" } });
	fireEvent.change(screen().getByLabelText("Path"), { target: { value: "/staff" } });
	// the dialog's own Import button comes after the page's
	await act(async () => {
		fireEvent.click(screen().getAllByText("Import").at(-1) as HTMLElement);
	});

	await waitFor(() => expect(navigate).toHaveBeenCalledWith(toCanvas));
	const retried = importSpy.mock.calls[1]?.[1] as { route: { name: string; path: string } };
	expect(retried.route).toEqual({ name: "Get Staff", path: "/staff" });
});
