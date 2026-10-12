import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the gate rows link to their targets
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

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { GateList } = await import("./DeploymentGates");

type DeployGateRef = import("@/services/deployments").DeployGateRef;

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const deployment = (gates: object[]) => ({
	id: "d1",
	kind: "route",
	targetId: "r1",
	versionId: "v2",
	versionNumber: 2,
	action: "promote",
	description: "why",
	author: "Ada",
	authorEmail: "ada@x.io",
	status: "failed",
	gates,
	createdAt: "2026-10-01T10:00:00.000Z",
	finishedAt: "2026-10-01T10:00:05.000Z",
});

const CUSTOM_BLOCKS = {
	gate: "custom_blocks",
	status: "failed",
	message: "These have no production version:",
	refs: [
		{ kind: "custom_block", id: "b1", name: "Slack notifier" },
		{ kind: "middleware", id: "m1", name: "Auth check" },
	],
};

const TESTS = {
	gate: "tests",
	status: "failed",
	message: "1 suite failed",
	refs: [{ kind: "route", id: "r9", name: "GET /orders", suite: "Orders suite" }],
};

function mount(options: {
	gates: object[];
	onCommitDependency?: (ref: DeployGateRef) => void;
	resolvedDeps?: Set<string>;
	onTryAgain?: () => void;
}) {
	return render(
		<GateList
			kind="route"
			id="r1"
			projectId="p1"
			deployment={deployment(options.gates) as never}
			onCommitDependency={options.onCommitDependency}
			resolvedDeps={options.resolvedDeps}
			onTryAgain={options.onTryAgain}
			canPromoteDeps
		/>,
	);
}

const buttons = (name: string) =>
	[...document.body.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);

test("the custom_blocks gate lists each dependency with a Commit & promote button", () => {
	const onCommitDependency = mock(() => undefined);
	mount({ gates: [CUSTOM_BLOCKS], onCommitDependency });
	expect(document.body.textContent).toContain("Slack notifier");
	expect(document.body.textContent).toContain("Auth check");
	const found = buttons("Commit & promote");
	expect(found.length).toBe(2);
	const first = found[0];
	if (!first) throw new Error("no first Commit & promote button");
	fireEvent.click(first);
	expect(onCommitDependency).toHaveBeenCalledWith(
		expect.objectContaining({ id: "b1", kind: "custom_block" }),
	);
});

test("once every dependency is live, Try again is offered and runs the original promote", () => {
	const onTryAgain = mock(() => undefined);
	mount({
		gates: [CUSTOM_BLOCKS],
		onCommitDependency: () => undefined,
		resolvedDeps: new Set(["b1", "m1"]),
		onTryAgain,
	});
	expect(buttons("Commit & promote").length).toBe(0);
	const tryAgain = buttons("Try again");
	expect(tryAgain.length).toBe(1);
	const first = tryAgain[0];
	if (!first) throw new Error("no Try again button");
	fireEvent.click(first);
	expect(onTryAgain).toHaveBeenCalled();
});

test("a partly resolved dependency keeps its button and shows no Try again", () => {
	mount({
		gates: [CUSTOM_BLOCKS],
		onCommitDependency: () => undefined,
		resolvedDeps: new Set(["b1"]),
		onTryAgain: () => undefined,
	});
	// b1 resolved, m1 still missing
	expect(buttons("Commit & promote").length).toBe(1);
	expect(buttons("Try again").length).toBe(0);
});

test("the tests gate names each failing user and its suite, with a link", () => {
	mount({ gates: [TESTS] });
	const link = [...document.body.querySelectorAll("a")].find((a) =>
		a.textContent?.includes("GET /orders"),
	);
	expect(link?.getAttribute("href")).toContain("routeId=r9");
	expect(document.body.textContent).toContain("Orders suite");
});

test("the warning message a gate carries is shown", () => {
	mount({
		gates: [{ gate: "custom_blocks", status: "warning", message: "Not used in production yet" }],
	});
	expect(document.body.textContent).toContain("Not used in production yet");
});

test("a route's own failed run links to its suite history, through the router", () => {
	mount({ gates: [{ ...TESTS, runId: "run-1" }] });
	const link = [...document.body.querySelectorAll("a")].find((a) =>
		a.textContent?.includes("Open the failed tests"),
	);
	// no /_/admin/ui prefix: Link adds it, and no hand-built href
	expect(link?.getAttribute("href")).toContain("/$projectId/canvas/$routeId/test-suites");
	expect(link?.getAttribute("href")).toContain("runId=run-1");
});
