import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the rows link to the resources they name
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({
		to,
		params,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		children: ReactNode;
	}) => (
		<a href={`${to}?${new URLSearchParams(params ?? {})}`} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { referencesService } = await import("@/services/references");
const { UsedBy } = await import("./UsedBy");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

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

function mount() {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<UsedBy kind="custom_block" id="b1" projectId="p1" />
		</QueryClientProvider>,
	);
}

test("each row shows the kind, the name, and the In production and Working copy tags", async () => {
	spyOn(referencesService, "list").mockResolvedValue([
		{ kind: "route", id: "r1", name: "GET /orders", inProduction: true, inWorkingCopy: false },
		{ kind: "workflow", id: "w1", name: "Nightly", inProduction: false, inWorkingCopy: true },
	] as never);
	const view = mount();
	await until(() => view.getByText("GET /orders"));

	const list = view.getByLabelText("Used by");
	expect(list.textContent).toContain("GET /orders");
	expect(list.textContent).toContain("In production");
	expect(list.textContent).toContain("Nightly");
	expect(list.textContent).toContain("Working copy");
	// each row is named by its kind
	const labels = view.getAllByRole("img").map((icon) => icon.getAttribute("aria-label"));
	expect(labels).toContain("Route");
	expect(labels).toContain("Workflow");
});

test("a test suite links to the tests page of its own route", async () => {
	spyOn(referencesService, "list").mockResolvedValue([
		{
			kind: "test_suite",
			id: "s1",
			name: "Orders suite",
			inProduction: false,
			inWorkingCopy: true,
			target: { kind: "route", id: "r1", name: "GET /orders" },
		},
	] as never);
	const view = mount();
	await until(() => view.getByText("Orders suite"));
	const link = view.getByText("Orders suite").closest("a");
	expect(link?.getAttribute("href")).toContain("test-suites");
	expect(link?.getAttribute("href")).toContain("routeId=r1");
});

test("nothing uses it shows the empty state", async () => {
	spyOn(referencesService, "list").mockResolvedValue([] as never);
	const view = mount();
	await until(() => view.getByText("Not used anywhere yet."));
});
