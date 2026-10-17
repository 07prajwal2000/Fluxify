import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { DangerZoneSettings } = await import("./DangerZoneSettings");
const { projectsService } = await import("@/services/projects");

const get = spyOn(projectsService, "getById");
const remove = spyOn(projectsService, "remove");

beforeEach(() => {
	get.mockReset().mockResolvedValue({ id: "p1", name: "billing" } as never);
	remove.mockReset().mockResolvedValue({ id: "p1" });
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

async function setup(onDeleted = () => {}) {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<DangerZoneSettings projectId="p1" onDeleted={onDeleted} />
		</QueryClientProvider>,
	);
	await act(() => new Promise((r) => setTimeout(r, 50)));
}

/** Every button labelled "Delete project": the page's, then the dialog's once it is open. */
const deleteButtons = () =>
	[...document.querySelectorAll("button")].filter(
		(b) => b.textContent?.trim() === "Delete project",
	) as HTMLButtonElement[];

test("the project is deleted only once its name is typed", async () => {
	let deleted = 0;
	await setup(() => void deleted++);

	await act(async () => fireEvent.click(deleteButtons()[0]));
	const input = document.querySelector("input") as HTMLInputElement;
	const confirm = () => deleteButtons().at(-1) as HTMLButtonElement;
	expect(confirm().disabled).toBe(true);

	await act(async () => fireEvent.change(input, { target: { value: "bill" } }));
	expect(confirm().disabled).toBe(true);

	await act(async () => fireEvent.change(input, { target: { value: "billing" } }));
	expect(confirm().disabled).toBe(false);

	await act(async () => fireEvent.click(confirm()));
	await act(() => new Promise((r) => setTimeout(r, 50)));
	expect(remove).toHaveBeenCalledWith("p1");
	expect(deleted).toBe(1);
});
