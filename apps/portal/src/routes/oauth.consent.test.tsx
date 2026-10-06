import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
	"http://localhost/_/admin/ui/oauth/consent?client_id=c1&scope=openid%20profile&ba_param=a&ba_param=b&sig=x",
);

const post = mock(async () => ({ data: { redirect: true, url: "http://localhost/back" } }));
mock.module("@/lib/http", () => ({
	httpClient: { get: async () => ({ data: { client_name: "Claude" } }), post },
}));
mock.module("@/lib/auth", () => ({ authClient: { getSession: mock() } }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConsentPage } = await import("./oauth.consent");
// What the router does to repeated keys right after load.
window.history.replaceState(null, "", "?client_id=c1&ba_param=%5B%22a%22%2C%22b%22%5D&sig=x");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());

test("Allow posts accept true with the raw oauth query", async () => {
	const box = document.createElement("div");
	document.body.append(box);
	const root = createRoot(box);
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<ConsentPage />
			</QueryClientProvider>,
		);
		await new Promise((r) => setTimeout(r, 50));
	});
	const allow = [...box.querySelectorAll("button")].find((b) => b.textContent === "Allow");
	await act(async () => {
		allow?.click();
		await new Promise((r) => setTimeout(r, 50));
	});
	expect(post).toHaveBeenCalledWith("/auth/oauth2/consent", {
		accept: true,
		oauth_query: "client_id=c1&scope=openid%20profile&ba_param=a&ba_param=b&sig=x",
	});
	await act(async () => root.unmount());
});
