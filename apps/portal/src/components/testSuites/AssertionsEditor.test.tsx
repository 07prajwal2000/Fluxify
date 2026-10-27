import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { responseSchemasService } = await import("@/services/responseSchemas");
const { AssertionsEditor } = await import("./AssertionsEditor");

afterEach(cleanup);
beforeEach(() => mock.restore());
afterAll(() => GlobalRegistrator.unregister());

// the saved list arrives on a promise; poll inside act so React flushes it
async function until(check: () => void, timeout = 1500) {
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

type Rows = Parameters<typeof AssertionsEditor>[0]["assertions"];

function setup(assertions: Rows, savedCodes: number[]) {
	spyOn(responseSchemasService, "list").mockResolvedValue(
		savedCodes.map((statusCode) => ({
			statusCode,
			schema: { dataType: "object" },
			updatedAt: "2026-01-01T00:00:00.000Z",
		})),
	);
	const onChange = mock();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<AssertionsEditor kind="route" routeId="r1" assertions={assertions} onChange={onChange} />
		</QueryClientProvider>,
	);
	const box = () => within(document.body).getByRole("checkbox") as HTMLInputElement;
	return { onChange, box };
}

test("ticking the checkbox adds a schema assertion beside the existing ones", async () => {
	const status = { target: "status", operator: "eq", expectedValue: "200" } as const;
	const { onChange, box } = setup([status], [200]);
	expect(box().checked).toBe(false);
	fireEvent.click(box());
	expect(onChange).toHaveBeenCalledWith([status, { target: "schema" }]);
});

test("unticking removes only the schema assertion, and it is not listed as a row", () => {
	const status = { target: "status", operator: "eq", expectedValue: "200" } as const;
	const { onChange, box } = setup([status, { target: "schema" }], [200]);
	expect(box().checked).toBe(true);
	// only the status assertion gets a row: the schema one lives in the checkbox
	expect(within(document.body).getAllByLabelText("Assertion target")).toHaveLength(1);
	fireEvent.click(box());
	expect(onChange).toHaveBeenCalledWith([status]);
});

test("says so when the route has no saved schema", async () => {
	setup([], []);
	await until(() => expect(document.body.textContent).toContain("No schema saved yet"));
});

test("lists the status codes that have a schema", async () => {
	setup([], [200, 404]);
	await until(() => expect(document.body.textContent).toContain("saved: 200, 404"));
});
