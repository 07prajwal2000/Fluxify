import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

// Monaco cannot load under `bun test` (Vite `?worker` entries); the editor is not what is tested here
mock.module("../../../../../../packages/components/src/JavaScriptTextArea/monacoEditor", () => ({
	MonacoEditor: () => <pre />,
}));

const { responseSchemasService } = await import("@/services/responseSchemas");
const { authStore } = await import("@/store/auth");
const { ResponseSchemasPanel } = await import("./ResponseSchemasPanel");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

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

const row = (statusCode: number) => ({
	statusCode,
	schema: { dataType: "object" as const, properties: [{ key: "id", dataType: "int" as const }] },
	updatedAt: "2026-01-01T00:00:00.000Z",
});

function setup(role: "viewer" | "creator", codes: number[]) {
	authStore
		.getState()
		.actions.setUserData({ id: "u1", name: "U", email: "u@x.io", isSystemAdmin: false });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);
	spyOn(responseSchemasService, "list").mockResolvedValue(codes.map(row));
	const put = spyOn(responseSchemasService, "put").mockResolvedValue({} as never);
	const remove = spyOn(responseSchemasService, "remove").mockResolvedValue();
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ResponseSchemasPanel routeId="r1" projectId="p1" />
		</QueryClientProvider>,
	);
	return { put, remove, view };
}

test("lists the saved status codes and shows the picked one", async () => {
	const { view } = setup("creator", [200, 404]);
	const list = await until(() => view.getByLabelText("Status codes"));
	expect(within(list).getAllByRole("button", { name: /^(200|404)$/ })).toHaveLength(2);
	await act(async () => fireEvent.click(within(list).getByRole("button", { name: "404" })));
	await until(() => view.getByRole("button", { name: "Save" }));
	// nothing edited yet: nothing to save
	expect((view.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a viewer can read but gets no add, save or delete controls", async () => {
	const { view } = setup("viewer", [200]);
	const list = await until(() => view.getByLabelText("Status codes"));
	await act(async () => fireEvent.click(within(list).getByRole("button", { name: "200" })));
	expect(view.queryByRole("button", { name: "Save" })).toBeNull();
	expect(view.queryByRole("button", { name: "Add" })).toBeNull();
	expect(view.queryByLabelText(/delete the 200 schema/i)).toBeNull();
});

test("a new status code opens an empty object schema that saves as typed", async () => {
	const { put, view } = setup("creator", []);
	const input = await until(() => view.getByPlaceholderText("200"));
	await act(async () => fireEvent.change(input, { target: { value: "418" } }));
	await act(async () => fireEvent.blur(input));
	await act(async () => fireEvent.click(view.getByRole("button", { name: "Add" })));
	await act(async () =>
		fireEvent.click(await until(() => view.getByRole("button", { name: "Save" }))),
	);
	await until(() =>
		expect(put).toHaveBeenCalledWith("r1", 418, {
			schema: { dataType: "object", properties: [] },
		}),
	);
});

test("delete asks first, then removes that status code", async () => {
	const { remove, view } = setup("creator", [200, 500]);
	const del = await until(() => view.getByLabelText("Delete the 500 schema"));
	await act(async () => fireEvent.click(del));
	expect(remove).not.toHaveBeenCalled();
	await act(async () =>
		fireEvent.click(within(document.body).getByRole("button", { name: "Delete" })),
	);
	await until(() => expect(remove).toHaveBeenCalledWith("r1", 500));
});
