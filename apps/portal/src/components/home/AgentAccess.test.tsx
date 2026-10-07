import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const post = mock(async () => ({ data: { key: "flx_secret_value" } }));
const get = mock(async (url: string) => ({
	data: url.includes("get-consents") ? [] : { apiKeys: [] },
}));
mock.module("@/lib/http", () => ({ httpClient: { get, post } }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AccessTokens, ConnectAgent } = await import("./AgentAccess");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());

test("creating a token shows the key once", async () => {
	const box = document.createElement("div");
	document.body.append(box);
	const root = createRoot(box);
	const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<AccessTokens />
			</QueryClientProvider>,
		);
	});
	await wait();

	const openBtn = [...box.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("New token"),
	);
	await act(async () => openBtn?.click());
	await wait();

	const input = document.querySelector("input") as HTMLInputElement;
	await act(async () => {
		const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
		set?.call(input, "laptop");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	const create = [...document.querySelectorAll("button")].find(
		(b) => b.textContent === "Create token",
	);
	await act(async () => create?.click());
	await wait();

	expect(post).toHaveBeenCalledWith("/auth/api-key/create", {
		name: "laptop",
		expiresIn: 90 * 24 * 60 * 60,
	});
	expect(document.body.textContent).toContain("flx_secret_value");
	expect(document.body.textContent).toContain("You won't see this again");
	await act(async () => root.unmount());
});

test("the connect panel links to the AI agents docs in a new tab", async () => {
	const box = document.createElement("div");
	document.body.append(box);
	const root = createRoot(box);
	await act(async () => root.render(<ConnectAgent />));
	const link = [...box.querySelectorAll("a")].find((a) => a.textContent === "Learn more");
	expect(link?.getAttribute("href")).toBe("https://docs.fluxify.rest/getting-started/ai-agents");
	expect(link?.getAttribute("target")).toBe("_blank");
	expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
	await act(async () => root.unmount());
});
