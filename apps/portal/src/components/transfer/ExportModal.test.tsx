import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { ExportModal } = await import("./ExportModal");
const { transferService } = await import("@/services/transfer");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const bundle = { kind: "fluxify.route" } as never;
const route = { id: "r1", name: "list users" };

// the dialog renders in a portal, outside the render container
const screen = () => within(document.body);

test("exports with tests by default", async () => {
	const exportRoute = spyOn(transferService, "export").mockResolvedValue(bundle);
	URL.createObjectURL = () => "blob:x";
	const onClose = mock(() => {});
	render(<ExportModal resourceType="route" resource={route} onClose={onClose} />);

	fireEvent.click(screen().getByText("Export"));

	await waitFor(() => expect(onClose).toHaveBeenCalled());
	expect(exportRoute).toHaveBeenCalledWith("route", "r1", true);
});

test("leaves the tests out when the checkbox is cleared", async () => {
	const exportRoute = spyOn(transferService, "export").mockResolvedValue(bundle);
	URL.createObjectURL = () => "blob:x";
	const onClose = mock(() => {});
	render(<ExportModal resourceType="route" resource={route} onClose={onClose} />);

	fireEvent.click(screen().getByText("Include tests"));
	fireEvent.click(screen().getByText("Export"));

	await waitFor(() => expect(onClose).toHaveBeenCalled());
	expect(exportRoute).toHaveBeenCalledWith("route", "r1", false);
});

test("stays closed without a resource", () => {
	render(<ExportModal resourceType="route" resource={null} onClose={() => {}} />);
	expect(screen().queryByText("Export route")).toBeNull();
});

test("words the dialog for a workflow", () => {
	render(
		<ExportModal
			resourceType="workflow"
			resource={{ id: "w1", name: "nightly" }}
			onClose={() => {}}
		/>,
	);
	expect(screen().getByText("Export workflow")).toBeTruthy();
});

test("exports a workflow as .fluxworkflow", async () => {
	spyOn(transferService, "export").mockResolvedValue({ kind: "fluxify.workflow" } as never);
	const download = spyOn(await import("./transferFile"), "downloadBundle").mockImplementation(
		() => {},
	);
	render(
		<ExportModal
			resourceType="workflow"
			resource={{ id: "w1", name: "nightly" }}
			onClose={() => {}}
		/>,
	);

	expect(screen().queryByText(/response schemas/)).toBeNull();
	fireEvent.click(screen().getByText("Export"));

	await waitFor(() => expect(download).toHaveBeenCalled());
	expect(String(download.mock.calls[0]?.[1])).toEndWith(".fluxworkflow");
});
