import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

GlobalRegistrator.register();

mock.module("@/lib/http", () => ({
	httpClient: {
		get: async (url: string) => ({ data: url.includes("get-consents") ? [] : { apiKeys: [] } }),
		post: async () => ({ data: {} }),
	},
}));
// The real client needs a base URL at import time; only the session is read here.
mock.module("@/lib/auth", () => ({
	authClient: {
		useSession: () => ({
			data: { user: { id: "user-1234567", name: "Ada Lovelace", email: "ada@example.com" } },
			isPending: false,
		}),
	},
}));
// Other test files mock the router too and the mocks leak across files in one
// process, so a real router is not reliable here. A Link that hands its search
// params to the test stands in for the URL.
type Search = Record<string, string>;
let navigate: (search: Search) => void = () => {};
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({ search, children, ...props }: { search: Search; children: ReactNode }) => (
		<a
			{...props}
			href={`/?${new URLSearchParams(search)}`}
			onClick={(e) => {
				e.preventDefault();
				navigate(search);
			}}
		>
			{children}
		</a>
	),
}));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AccountDetails } = await import("./AccountDetails");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());

test("switching account sections shows the right panel and puts it in the URL", async () => {
	let lastSearch: Search = {};
	function Page() {
		const [search, setSearch] = useState<Search>({ tab: "account" });
		navigate = (next) => {
			lastSearch = next;
			setSearch(next);
		};
		return <AccountDetails activeTab={search.accountTab ?? "profile"} />;
	}

	const box = document.createElement("div");
	document.body.append(box);
	const root = createRoot(box);
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<Page />
			</QueryClientProvider>,
		);
	});
	const link = (label: string) =>
		[...box.querySelectorAll("nav a")].find((a) => a.textContent === label) as HTMLAnchorElement;

	expect(box.textContent).toContain("Personal information");
	expect(box.textContent).not.toContain("Update password");
	expect(link("Profile").getAttribute("aria-current")).toBe("page");

	await act(async () => link("Password").click());
	expect(lastSearch).toEqual({ tab: "account", accountTab: "password" });
	expect(box.textContent).toContain("Update password");
	expect(box.textContent).not.toContain("Personal information");

	await act(async () => link("Connect an AI agent").click());
	expect(lastSearch).toEqual({ tab: "account", accountTab: "agent" });
	expect(box.textContent).not.toContain("Update password");
	expect(link("Connect an AI agent").getAttribute("aria-current")).toBe("page");
	expect(link("Profile").getAttribute("aria-current")).toBeNull();
	await act(async () => root.unmount());
});
