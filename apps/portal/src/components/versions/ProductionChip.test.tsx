import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the chip is a link into the version history
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({
		to,
		params,
		search,
		children,
		...rest
	}: {
		to: string;
		params: object;
		search?: object;
		children: ReactNode;
	}) => (
		<a
			href={`${to}?${new URLSearchParams({
				...(params as Record<string, string>),
				...(search as Record<string, string>),
			})}`}
			{...rest}
		>
			{children}
		</a>
	),
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { routesService } = await import("@/services/routes");
const { ProductionChip } = await import("./ProductionChip");

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

function mount() {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ProductionChip kind="route" id="r1" projectId="p1" />
		</QueryClientProvider>,
	);
}

test("a promoted route shows Prod vN, linking to the history", async () => {
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		name: "Orders",
		prodVersionNumber: 3,
	} as never);
	const view = mount();
	await until(() => view.getByText("Prod v3"));
	const link = view.getByText("Prod v3").closest("a");
	expect(link?.getAttribute("href")).toContain("versions");
	// it opens the Production tab, so the click shows which version is live (#739)
	expect(link?.getAttribute("href")).toContain("tab=production");
});

test("an unpromoted route says so", async () => {
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		name: "Orders",
		prodVersionNumber: null,
	} as never);
	const view = mount();
	await until(() => view.getByText("Not in production"));
});
