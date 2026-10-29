import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { ExportRouteModal } = await import("./ExportRouteModal");
const { routesService } = await import("@/services/routes");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const bundle = { kind: "fluxify.route" } as never;
const route = { id: "r1", name: "list users" };

// the dialog renders in a portal, outside the render container
const screen = () => within(document.body);

test("exports with tests by default", async () => {
	const exportRoute = spyOn(routesService, "export").mockResolvedValue(bundle);
	URL.createObjectURL = () => "blob:x";
	const onClose = mock(() => {});
	render(<ExportRouteModal route={route} onClose={onClose} />);

	fireEvent.click(screen().getByText("Export"));

	await waitFor(() => expect(onClose).toHaveBeenCalled());
	expect(exportRoute).toHaveBeenCalledWith("r1", true);
});

test("leaves the tests out when the checkbox is cleared", async () => {
	const exportRoute = spyOn(routesService, "export").mockResolvedValue(bundle);
	URL.createObjectURL = () => "blob:x";
	const onClose = mock(() => {});
	render(<ExportRouteModal route={route} onClose={onClose} />);

	fireEvent.click(screen().getByText("Include tests"));
	fireEvent.click(screen().getByText("Export"));

	await waitFor(() => expect(onClose).toHaveBeenCalled());
	expect(exportRoute).toHaveBeenCalledWith("r1", false);
});

test("stays closed without a route", () => {
	render(<ExportRouteModal route={null} onClose={() => {}} />);
	expect(screen().queryByText("Export route")).toBeNull();
});
