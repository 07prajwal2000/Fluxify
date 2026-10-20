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
const { emptyDiff, upgrading } = await import("./fixtures");

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
