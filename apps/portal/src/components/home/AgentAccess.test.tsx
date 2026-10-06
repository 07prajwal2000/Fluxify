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
const { AgentAccess } = await import("./AgentAccess");

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
				<AgentAccess />
			</QueryClientProvider>,
		);
	});
	await wait();

	const input = box.querySelector("input") as HTMLInputElement;
	await act(async () => {
		const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
		set?.call(input, "laptop");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	const create = [...box.querySelectorAll("button")].find((b) => b.textContent === "Create token");
	await act(async () => create?.click());
	await wait();

	expect(post).toHaveBeenCalledWith("/auth/api-key/create", {
		name: "laptop",
		expiresIn: 90 * 24 * 60 * 60,
	});
	expect(box.textContent).toContain("flx_secret_value");
	expect(box.textContent).toContain("You won't see this again");
	await act(async () => root.unmount());
});
