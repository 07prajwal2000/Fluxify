import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// the rows link to the canvases that use the plugin
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ApprovalDialog } = await import("./ApprovalDialog");
const { RemovePluginDialog } = await import("./RemovePluginDialog");
const { pluginsService } = await import("@/services/plugins");
const { emptyDiff, plugin, upgrading } = await import("./fixtures");

const upgradePreview = spyOn(pluginsService, "upgradePreview");
const approve = spyOn(pluginsService, "approve");
const remove = spyOn(pluginsService, "remove");

const user = { kind: "route", id: "r1", name: "GET /orders" } as const;
const blockingDiff = {
	...emptyDiff,
	blocking: true,
	blockers: ["param retries of acme/slack/messages/post is removed but set by route GET /orders"],
	removedParams: [{ block: "acme/slack/messages/post", param: "retries", usedBy: [user] }],
};
const preview = (diff: typeof emptyDiff) => ({
	from: { version: "1.0.0", integrity: "sha512-abc" },
	to: { version: "1.1.0", integrity: "sha512-new" },
	diff,
});

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

const button = (name: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent === name) as
		| HTMLButtonElement
		| undefined;

beforeEach(() => {
	upgradePreview.mockReset();
	approve.mockReset();
	remove.mockReset();
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const wrap = (node: ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

const conflict = (data: object) => ({ response: { status: 409, data } });

test("an upgrade that removes something in use cannot be approved, and says what and where", async () => {
	upgradePreview.mockResolvedValue(preview(blockingDiff) as never);
	wrap(<ApprovalDialog projectId="p1" plugin={upgrading()} open onOpenChange={() => {}} />);

	await until(() => expect(document.body.textContent).toContain("retries"));
	expect(document.body.textContent).toContain("cannot be approved");
	expect(document.body.textContent).toContain("GET /orders");
	expect(document.body.textContent).toContain("move together");
	expect(button("Approve")?.disabled).toBe(true);
	expect(approve).not.toHaveBeenCalled();
});

test("a clean upgrade is approved with the integrity that was reviewed", async () => {
	upgradePreview.mockResolvedValue(preview(emptyDiff) as never);
	approve.mockResolvedValue(upgrading());
	wrap(<ApprovalDialog projectId="p1" plugin={upgrading()} open onOpenChange={() => {}} />);

	await until(() => expect(button("Approve")?.disabled).toBe(false));
	await act(async () => void fireEvent.click(button("Approve")!));
	await until(() => expect(approve).toHaveBeenCalledWith("p1", "acme/slack", "sha512-new"));
});

test("a 409 from the server shows the same blocking view", async () => {
	upgradePreview.mockResolvedValue(preview(emptyDiff) as never);
	approve.mockRejectedValue(
		conflict({ message: "Plugin acme/slack@1.1.0 cannot replace 1.0.0", diff: blockingDiff }),
	);
	wrap(<ApprovalDialog projectId="p1" plugin={upgrading()} open onOpenChange={() => {}} />);

	await until(() => expect(button("Approve")?.disabled).toBe(false));
	await act(async () => void fireEvent.click(button("Approve")!));
	await until(() => expect(document.body.textContent).toContain("cannot be approved"));
	expect(document.body.textContent).toContain("Plugin acme/slack@1.1.0 cannot replace 1.0.0");
	expect(button("Approve")?.disabled).toBe(true);
});

test("a refused removal lists who still uses the plugin, as links", async () => {
	remove.mockRejectedValue(
		conflict({
			message: "This plugin is still used by route GET /orders. Remove it there first.",
			references: [{ ...user, inProduction: true, inWorkingCopy: true }],
		}),
	);
	wrap(
		<RemovePluginDialog
			projectId="p1"
			name="acme/slack"
			open
			onOpenChange={() => {}}
			onRemoved={() => {}}
		/>,
	);

	await act(async () => void fireEvent.click(button("Remove")!));
	await until(() => expect(document.body.textContent).toContain("still used by route GET /orders"));
	const link = [...document.querySelectorAll("a")].find((a) => a.textContent === "GET /orders");
	expect(link).toBeTruthy();
	expect(document.body.textContent).toContain("In production");
});

test("an upgrade that has breaking integration changes shows them with blocking count and links", async () => {
	const integrationDiff = {
		...emptyDiff,
		blocking: true,
		blockers: ["integration crm/hubspot is breaking and used by 1 integration"],
		changedIntegrations: [
			{
				kind: "crm/hubspot",
				change: "apiKey parameter removed",
				breaking: true,
				usedBy: [{ id: "int-1", name: "Hubspot Production" }],
			},
		],
		removedIntegrations: [
			{
				kind: "crm/salesforce",
				usedBy: [{ id: "int-2", name: "Salesforce Dev" }],
			},
		],
		addedIntegrations: ["crm/zendesk"],
	};
	upgradePreview.mockResolvedValue(preview(integrationDiff) as never);
	wrap(<ApprovalDialog projectId="p1" plugin={upgrading()} open onOpenChange={() => {}} />);

	await until(() => expect(document.body.textContent).toContain("crm/hubspot"));
	expect(document.body.textContent).toContain("apiKey parameter removed");
	expect(document.body.textContent).toContain("Breaking · 1 blocking");
	expect(document.body.textContent).toContain("Hubspot Production");
	expect(document.body.textContent).toContain("1 integration blocking");
	expect(document.body.textContent).toContain("Salesforce Dev");
	expect(document.body.textContent).toContain("crm/zendesk");
	expect(button("Approve")?.disabled).toBe(true);
});

test("approval dialog shows plugin integrations with secret params and hooks", async () => {
	const pluginWithIntegrations = {
		...upgrading(),
		integrations: [
			{
				group: "crm",
				variant: "hubspot",
				label: "HubSpot CRM",
				ownGroup: true,
				secretParams: ["apiKey", "appSecret"],
				hooks: { test: true, describe: false, inspect: true },
			},
		],
	};
	upgradePreview.mockResolvedValue(preview(emptyDiff) as never);
	wrap(
		<ApprovalDialog projectId="p1" plugin={pluginWithIntegrations} open onOpenChange={() => {}} />,
	);

	await until(() => expect(document.body.textContent).toContain("HubSpot CRM"));
	expect(document.body.textContent).toContain("crm/hubspot");
	expect(document.body.textContent).toContain("apiKey, appSecret");
	expect(document.body.textContent).toContain("test");
	expect(document.body.textContent).toContain("inspect");
});

test("approval lists the plugin's trigger kinds with their permissions", async () => {
	const withTriggers = plugin({
		manifest: {
			...plugin().manifest,
			triggers: [
				{
					name: "acme/slack/poll",
					label: "Poll Slack",
					description: "Polls a channel",
					icon: "",
					permissions: { integrations: ["kv"], appconfig: true },
					retry: true,
					params: {},
					entry: "dist/triggers/poll.js",
				},
			],
		} as never,
	});
	wrap(<ApprovalDialog projectId="p1" plugin={withTriggers} open onOpenChange={() => {}} />);

	await until(() => expect(document.body.textContent).toContain("Trigger kinds"));
	expect(document.body.textContent).toContain("Poll Slack");
	expect(document.body.textContent).toContain("acme/slack/poll");
	expect(document.body.textContent).toContain("Integrations: kv · Read app config");
	expect(document.body.textContent).toContain("Retries");
});

test("an upgrade diff lists added, removed and changed trigger kinds", async () => {
	upgradePreview.mockResolvedValue(
		preview({
			...emptyDiff,
			blocking: true,
			blockers: ['trigger kind acme/slack/poll is removed but used by trigger "Poller"'],
			addedTriggers: ["acme/slack/hook"],
			removedTriggers: [{ kind: "acme/slack/poll", usedBy: [{ id: "t1", name: "Poller" }] }],
			changedTriggers: [
				{
					kind: "acme/slack/listen",
					change: "retry turned on",
					breaking: false,
					usedBy: [{ id: "t2", name: "Listener" }],
				},
			],
		}) as never,
	);
	wrap(<ApprovalDialog projectId="p1" plugin={upgrading()} open onOpenChange={() => {}} />);

	await until(() => expect(document.body.textContent).toContain("Removed trigger kinds"));
	expect(document.body.textContent).toContain("acme/slack/poll");
	expect(document.body.textContent).toContain("Changed trigger kinds");
	expect(document.body.textContent).toContain("retry turned on");
	expect(document.body.textContent).toContain("New trigger kinds");
	expect(document.body.textContent).toContain("acme/slack/hook");
	const link = [...document.querySelectorAll("a")].find((a) => a.textContent === "Poller");
	expect(link).toBeTruthy();
});

test("a refused removal with details.triggers lists the trigger rows as links", async () => {
	remove.mockRejectedValue(
		conflict({
			message: 'Plugin acme/slack still provides triggers "Poller" (acme/slack/poll)',
			details: { triggers: [{ id: "t1", name: "Poller", kind: "acme/slack/poll" }] },
		}),
	);
	wrap(
		<RemovePluginDialog
			projectId="p1"
			name="acme/slack"
			open
			onOpenChange={() => {}}
			onRemoved={() => {}}
		/>,
	);

	await act(async () => void fireEvent.click(button("Remove")!));
	await until(() => expect(document.body.textContent).toContain("still provides triggers"));
	const link = [...document.querySelectorAll("a")].find((a) => a.textContent === "Poller");
	expect(link).toBeTruthy();
	expect(document.body.textContent).toContain("(acme/slack/poll)");
});

test("a refused removal with details.integrations lists blocking integrations as router links", async () => {
	remove.mockRejectedValue(
		conflict({
			message: "Plugin acme/slack still provides integrations. Delete them first.",
			details: {
				integrations: [
					{ id: "int-10", name: "My Slack Integration", group: "crm", variant: "slack" },
				],
			},
		}),
	);
	wrap(
		<RemovePluginDialog
			projectId="p1"
			name="acme/slack"
			open
			onOpenChange={() => {}}
			onRemoved={() => {}}
		/>,
	);

	await act(async () => void fireEvent.click(button("Remove")!));
	await until(() =>
		expect(document.body.textContent).toContain("Plugin acme/slack still provides integrations"),
	);
	const link = [...document.querySelectorAll("a")].find(
		(a) => a.textContent === "My Slack Integration",
	);
	expect(link).toBeTruthy();
	expect(document.body.textContent).toContain("crm/slack");
});
