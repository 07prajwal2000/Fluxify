import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { responseSchemasService } = await import("@/services/responseSchemas");
const { SaveSchemaButton } = await import("./SaveSchemaButton");

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

function setup(response: { status: number; body?: string }, saved: number[] = []) {
	spyOn(responseSchemasService, "list").mockResolvedValue(
		saved.map((statusCode) => ({
			statusCode,
			schema: { dataType: "object" },
			updatedAt: "2026-01-01T00:00:00.000Z",
		})),
	);
	const put = spyOn(responseSchemasService, "put").mockResolvedValue({} as never);
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<SaveSchemaButton routeId="r1" response={response} />
		</QueryClientProvider>,
	);
	const button = () => view.getByRole("button", { name: /save as schema/i });
	return { put, view, button };
}

test("saves the parsed body for the response's status code", async () => {
	const { put, button } = setup({ status: 201, body: '{"id":1}' });
	await act(async () => fireEvent.click(button()));
	await until(() => expect(put).toHaveBeenCalledWith("r1", 201, { sample: { id: 1 } }));
});

test("is disabled, with the reason, for a body that is not JSON", () => {
	const { button, view } = setup({ status: 200, body: "plain text" });
	expect((button() as HTMLButtonElement).disabled).toBe(true);
	expect(view.getByTitle(/only json/i)).toBeTruthy();
});

test("asks before replacing an existing schema, and does not save on cancel", async () => {
	const { put, button } = setup({ status: 200, body: "{}" }, [200]);
	// the saved list has to have arrived, or the click saves straight away
	await act(() => new Promise((r) => setTimeout(r, 60)));
	await act(async () => fireEvent.click(button()));
	const dialog = await until(() => within(document.body).getByText(/replace the 200 schema/i));
	expect(dialog).toBeTruthy();
	expect(put).not.toHaveBeenCalled();
	await act(async () =>
		fireEvent.click(within(document.body).getByRole("button", { name: "Replace" })),
	);
	await until(() => expect(put).toHaveBeenCalledWith("r1", 200, { sample: {} }));
});
