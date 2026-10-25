import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { middlewaresService } = await import("@/services/middlewares");
const { VersionSettings } = await import("./VersionSettings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
	mock.restore();
	spyOn(middlewaresService, "getAll").mockResolvedValue([]);
});

function renderSettings(settings: Record<string, unknown>) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<VersionSettings kind="route" projectId="p1" settings={settings} />
		</QueryClientProvider>,
	);
}

test("a version's response schemas show one summary per status code", () => {
	const view = renderSettings({
		responseSchemas: [
			{
				statusCode: 200,
				schema: { dataType: "object", properties: [{ key: "total", dataType: "int" }] },
			},
			{
				statusCode: 404,
				schema: { dataType: "object", properties: [{ key: "reason", dataType: "str" }] },
			},
		],
	});
	const text = view.getByLabelText("Version settings").textContent;
	expect(text).toContain("Response schemas");
	for (const part of ["200", "total", "404", "reason"]) expect(text).toContain(part);
});

test("a version from before response schemas existed says none saved", () => {
	const view = renderSettings({ method: "get", path: "/x" });
	const section = view.getByText("Response schemas").closest("section, div")?.parentElement;
	expect(section?.textContent).toContain("None saved.");
});
