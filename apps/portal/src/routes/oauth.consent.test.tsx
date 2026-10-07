import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { AxiosError, type AxiosResponse } from "axios";

const EXP = Math.floor(Date.now() / 1000) + 600;
const RAW = `client_id=c1&scope=openid%20profile&ba_param=a&ba_param=b&exp=${EXP}&sig=x`;

GlobalRegistrator.register();
(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
	`http://localhost/_/admin/ui/oauth/consent?${RAW}`,
);

const post = mock(async (..._args: unknown[]) => ({
	data: { redirect: true, url: "http://localhost/back" },
}));
mock.module("@/lib/http", () => ({
	httpClient: { get: async () => ({ data: { client_name: "Claude" } }), post },
}));
mock.module("@/lib/auth", () => ({ authClient: { getSession: mock() } }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConsentPage, isExpired } = await import("./oauth.consent");
// What the router does to repeated keys right after load.
window.history.replaceState(null, "", "?client_id=c1&ba_param=%5B%22a%22%2C%22b%22%5D&sig=x");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => post.mockClear());

const settle = () => new Promise((r) => setTimeout(r, 50));

async function renderPage(query?: string) {
	const box = document.createElement("div");
	document.body.append(box);
	const root = createRoot(box);
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<ConsentPage query={query} />
			</QueryClientProvider>,
		);
		await settle();
	});
	const button = (name: string) =>
		[...box.querySelectorAll("button")].find((b) => b.textContent === name);
	return { box, button, unmount: () => act(async () => root.unmount()) };
}

test("Allow posts accept true with the raw oauth query", async () => {
	const page = await renderPage();
	expect(page.box.textContent).toContain("wants to access your Fluxify account");
	expect(page.box.textContent).toContain("Know who you are");
	expect(page.box.textContent).toContain("See your name");
	expect(page.box.textContent).not.toContain("openid");
	await act(async () => {
		page.button("Allow")?.click();
		await settle();
	});
	expect(post).toHaveBeenCalledWith("/auth/oauth2/consent", { accept: true, oauth_query: RAW });
	await page.unmount();
});

test("an expired or missing exp shows the expired state, without buttons", async () => {
	expect(isExpired(`exp=${EXP}`)).toBe(false);
	expect(isExpired("client_id=c1")).toBe(true);
	expect(isExpired("exp=soon")).toBe(true);
	const page = await renderPage(`client_id=c1&exp=${Math.floor(Date.now() / 1000) - 1}&sig=x`);
	expect(page.box.textContent).toContain("This request has expired");
	expect(page.box.textContent).toContain("Start the connection again from your AI app.");
	expect(page.button("Allow")).toBeUndefined();
	expect(page.button("Deny")).toBeUndefined();
	await page.unmount();
});

test("a 400 invalid_signature on Allow shows the expired state", async () => {
	post.mockImplementationOnce(async () => {
		throw new AxiosError("bad", "ERR_BAD_REQUEST", undefined, undefined, {
			status: 400,
			data: { error: "invalid_signature" },
		} as AxiosResponse);
	});
	const page = await renderPage();
	await act(async () => {
		page.button("Allow")?.click();
		await settle();
	});
	expect(post).toHaveBeenCalledTimes(1);
	expect(page.box.textContent).toContain("This request has expired");
	expect(page.button("Allow")).toBeUndefined();
	await page.unmount();
});
