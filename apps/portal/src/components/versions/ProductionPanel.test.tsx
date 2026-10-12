import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// A failed tests gate links to its run through the router, so `Link` is stubbed
// to keep the path and query the router would resolve, the base path aside.
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
		params?: Record<string, string>;
		search?: Record<string, string>;
		children: ReactNode;
	}) => (
		<a href={`${to}?${new URLSearchParams({ ...(params ?? {}), ...(search ?? {}) })}`} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { deploymentsService } = await import("@/services/deployments");
const { ProductionPanel } = await import("./ProductionPanel");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const list = () => spyOn(deploymentsService, "list");

const version = (n: number, isProd: boolean) => ({
	id: `v${n}`,
	kind: "route" as const,
	targetId: "r1",
	versionNumber: n,
	title: `Title ${n}`,
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: null,
	isHead: true,
	isProd,
});

const deployment = (extra: object = {}) => ({
	id: "d1",
	kind: "route",
	targetId: "r1",
	versionId: "v2",
	versionNumber: 2,
	action: "promote",
	description: "Health fix",
	author: "Ada",
	authorEmail: "ada@x.io",
	status: "failed" as const,
	gates: [
		{ gate: "compile", status: "passed", message: "The version compiles" },
		{ gate: "tests", status: "failed", message: "1 suite failed" },
	],
	createdAt: "2026-10-01T10:00:00.000Z",
	finishedAt: "2026-10-01T10:00:05.000Z",
	...extra,
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

function mount(versions: ReturnType<typeof version>[]) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ProductionPanel kind="route" id="r1" projectId="p1" versions={versions} />
		</QueryClientProvider>,
	);
}

function row(n: number) {
	const found = [
		...document.body.querySelectorAll('ul[aria-label="Production history"] > li'),
	].find((li) => li.textContent?.includes(`v${n}`));
	if (!found) throw new Error(`no row v${n}`);
	return found;
}

test("the live version is named, and the log lists each promote", async () => {
	list().mockResolvedValue({ deployments: [deployment()] } as never);
	const view = mount([version(2, true), version(1, false)]);
	await until(() => view.getByLabelText("Production history"));
	expect(document.body.textContent).toContain("In production:");
	expect(document.body.textContent).toContain("v2");
	expect(document.body.textContent).toContain("Title 2");

	const history = view.getByLabelText("Production history").textContent ?? "";
	expect(history).toContain("v2");
	expect(history).toContain("Promote");
	expect(history).toContain("Health fix");
	expect(history).toContain("Failed");
});

test("only the deployment serving production now says Live", async () => {
	list().mockResolvedValue({
		deployments: [
			// newest first: v2 is live now (a rollback to v1 happened before)
			deployment({ id: "d2", versionId: "v2", versionNumber: 2, status: "live" }),
			deployment({
				id: "d1",
				versionId: "v3",
				versionNumber: 3,
				action: "rollback",
				status: "live",
			}),
		],
	} as never);
	mount([version(2, true), version(1, false)]);
	await until(() => row(2));
	expect(row(2).textContent).toContain("Live");
	// the earlier successful rollback is not "Live"; it says what it did
	expect(row(3).textContent).not.toContain("Live");
	expect(row(3).textContent).toContain("Rolled back");
});

test("a past successful promote reads as Promoted", async () => {
	list().mockResolvedValue({
		deployments: [
			deployment({ id: "d2", versionId: "v2", versionNumber: 2, status: "live" }),
			deployment({ id: "d1", versionId: "v3", versionNumber: 3, status: "live" }),
		],
	} as never);
	mount([version(2, true)]);
	await until(() => row(3));
	expect(row(3).textContent).toContain("Promoted");
	expect(row(3).textContent).not.toContain("Live");
});

test("the row's time carries the exact moment on hover", async () => {
	list().mockResolvedValue({ deployments: [deployment()] } as never);
	mount([version(2, true)]);
	await until(() => row(2));
	expect(row(2).querySelector("time")?.getAttribute("title")).toBeTruthy();
});

test("a failed tests gate links straight to the run", async () => {
	list().mockResolvedValue({
		deployments: [
			deployment({
				id: "d1",
				status: "failed",
				gates: [
					{ gate: "compile", status: "passed", message: "The version compiles" },
					{
						gate: "tests",
						status: "failed",
						message: "1 suite failed",
						runId: "run-42",
					},
				],
			}),
		],
	} as never);
	mount([version(2, true)]);
	const expander = await until(() => {
		const found = [...document.body.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Show failed checks",
		);
		if (!found) throw new Error("no expander yet");
		return found;
	});
	fireEvent.click(expander);
	const link = await until(() => {
		const found = [...document.body.querySelectorAll("a")].find(
			(a) => a.textContent?.trim() === "Open the failed tests",
		);
		if (!found) throw new Error("no link yet");
		return found;
	});
	expect(link.getAttribute("href")).toContain("runId=run-42");
});

test("a failed promote keeps its reasons, behind an expander", async () => {
	list().mockResolvedValue({ deployments: [deployment()] } as never);
	mount([version(2, true)]);
	const expander = await until(() => {
		const found = [...document.body.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Show failed checks",
		);
		if (!found) throw new Error("no expander yet");
		return found;
	});
	fireEvent.click(expander);
	await until(() => document.body.textContent?.includes("1 suite failed"));
	expect(document.body.textContent).toContain("1 suite failed");
});

test("nothing promoted says so", async () => {
	list().mockResolvedValue({ deployments: [] } as never);
	mount([version(1, false)]);
	await until(() => document.body.textContent?.includes("Not in production yet"));
	expect(document.body.textContent).toContain("Not in production yet");
});
