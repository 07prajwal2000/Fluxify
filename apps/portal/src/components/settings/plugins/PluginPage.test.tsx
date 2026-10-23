import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// the used-by list links to triggers and integrations
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { PluginPage } = await import("./PluginPage");
const { pluginsService } = await import("@/services/plugins");
const { plugin } = await import("./fixtures");

const installStatus = spyOn(pluginsService, "installStatus");
const usage = spyOn(pluginsService, "usage");

async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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

const withTrigger = () =>
	plugin({
		manifest: {
			...plugin().manifest,
			triggers: [
				{
					name: "acme/slack/poll",
					label: "Poll Slack",
					description: "Polls a channel",
					icon: "",
					permissions: { integrations: ["kv"], appconfig: false },
					retry: true,
					params: {},
					entry: "dist/triggers/poll.js",
				},
			],
		} as never,
	});

beforeEach(() => {
	installStatus.mockReset().mockResolvedValue({
		version: "1.0.0",
		integrity: "sha512-abc",
		done: true,
		failed: false,
		nodes: [],
	});
	usage.mockReset().mockResolvedValue({
		blocks: [],
		triggers: [{ id: "t1", name: "Poller", kind: "acme/slack/poll" }],
		integrations: [{ id: "i1", name: "Slack Prod", group: "kv", variant: "redis" }],
	} as never);
});

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const page = (over = withTrigger()) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<PluginPage projectId="p1" plugin={over} editable={false} onBack={() => {}} />
		</QueryClientProvider>,
	);

test("the plugin page says the version ships a trigger, with its permissions", async () => {
	const view = page();
	await until(() => expect(view.getByText("Poll Slack")).toBeTruthy());
	const kinds = view.getByTestId("plugin-trigger-kinds");
	expect(kinds.textContent).toContain("acme/slack/poll");
	expect(kinds.textContent).toContain("Integrations: kv");
	expect(kinds.textContent).toContain("Retries");
	// no icon declared: the same bolt the Triggers page uses
	expect(kinds.querySelector('[data-testid="plugin-trigger-icon-default"]')).not.toBeNull();
});

test("used by lists the plugin's trigger rows and integrations, not only blocks", async () => {
	const view = page();
	await until(() => expect(view.getByText("Poller")).toBeTruthy());
	expect(view.getByText("Slack Prod")).toBeTruthy();
	expect(view.getByText("kv/redis")).toBeTruthy();
	expect(view.getByRole("list", { name: "Triggers using the plugin" }).textContent).toContain(
		"Poller",
	);
	expect(view.getByRole("list", { name: "Integrations of the plugin" }).textContent).toContain(
		"Slack Prod",
	);
});
