import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Mock canvas-confetti at module level so it's available before dynamic imports.
const confettiMock = mock(() => undefined);
mock.module("canvas-confetti", () => ({ default: confettiMock }));

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { deploymentsService } = await import("@/services/deployments");
const { DeployDialog } = await import("./DeployDialog");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
	mock.restore();
	confettiMock.mockClear();
});

const deploy = () => spyOn(deploymentsService, "deploy");
const poll = () => spyOn(deploymentsService, "get");

const version = (n: number) => ({
	id: `version-${n}`,
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
	isProd: false,
});

const deployment = (extra: object = {}) => ({
	id: "d1",
	kind: "route",
	targetId: "r1",
	versionId: "version-2",
	versionNumber: 2,
	action: "promote",
	description: "why",
	author: "Ada",
	authorEmail: "ada@x.io",
	status: "pending",
	gates: [],
	createdAt: "2026-10-01T10:00:00.000Z",
	finishedAt: null,
	...extra,
});

const GATES = [
	{ gate: "compile", status: "passed", message: "The version compiles" },
	{ gate: "values", status: "passed", message: "Every value has a production value" },
	{ gate: "path", status: "passed", message: "GET /orders is free in production" },
	{ gate: "custom_blocks", status: "warning", message: "Custom blocks run their current state" },
	{ gate: "tests", status: "passed", message: "All suites passed" },
];

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 2500): Promise<T> {
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

function mount(liveVersionNumber: number | null = null, versionNumber = 2) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<DeployDialog
				kind="route"
				id="r1"
				projectId="p1"
				version={version(versionNumber)}
				liveVersionNumber={liveVersionNumber}
				onClose={() => {}}
			/>
		</QueryClientProvider>,
	);
}

const button = (name: string) =>
	[...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	) as HTMLButtonElement;

const textarea = () => document.body.querySelector("textarea") as HTMLTextAreaElement;

async function fillDescription(value: string) {
	await until(() => textarea());
	fireEvent.change(textarea(), { target: { value } });
}

test("the description is required, then it posts the reason", async () => {
	const success = spyOn(toast, "success").mockImplementation((() => "") as never);
	const start = deploy().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
	mount();
	expect(button("Promote").disabled).toBe(true);
	await fillDescription("Health fix");
	await until(() => expect(button("Promote").disabled).toBe(false));
	fireEvent.click(button("Promote"));

	await until(() => expect(start).toHaveBeenCalled());
	expect(start).toHaveBeenCalledWith("route", "r1", {
		versionId: "version-2",
		description: "Health fix",
	});
	await until(() => expect(success).toHaveBeenCalledWith("Live in production"));
	expect(document.body.textContent).toContain("v2 is live in production");
});

test("an older version reads as a rollback", async () => {
	mount(3, 2);
	await until(() => document.body.textContent?.includes("Roll back to v2"));
	expect(button("Roll back")).toBeTruthy();
});

test("polling shows every gate, then stops at live", async () => {
	deploy().mockResolvedValue(deployment() as never);
	const read = poll().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
	mount();
	await fillDescription("Go live");
	fireEvent.click(button("Promote"));

	await until(() => expect(document.body.textContent).toContain("The version compiles"));
	const checks = document.body.querySelector('[aria-label="Promote checks"]');
	expect(checks?.textContent).toContain("Compiles");
	expect(checks?.textContent).toContain("Production values");
	expect(checks?.textContent).toContain("Production path is free");
	expect(checks?.textContent).toContain("Custom blocks and middlewares");
	expect(checks?.textContent).toContain("Tests");
	expect(document.body.textContent).toContain("Custom blocks run their current state");

	// live is terminal: no further reads
	const settled = read.mock.calls.length;
	await act(() => new Promise((r) => setTimeout(r, 1700)));
	expect(read.mock.calls.length).toBe(settled);
});

test("a failed deployment keeps the reasons on screen", async () => {
	deploy().mockResolvedValue(deployment() as never);
	poll().mockResolvedValue(
		deployment({
			status: "failed",
			gates: [
				{ gate: "compile", status: "passed", message: "The version compiles" },
				{
					gate: "tests",
					status: "failed",
					message: "1 suite failed",
					items: ["Orders suite: expected 200, got 500"],
				},
			],
		}) as never,
	);
	mount();
	await fillDescription("Go live");
	fireEvent.click(button("Promote"));

	await until(() => expect(document.body.textContent).toContain("1 suite failed"));
	expect(document.body.textContent).toContain("Orders suite: expected 200, got 500");
	expect(document.body.textContent).toContain("could not go live");
});

test("a 409 deployment in progress shows as a message", async () => {
	deploy().mockRejectedValue(
		Object.assign(new Error("Request failed with status code 409"), {
			isAxiosError: true,
			response: {
				status: 409,
				data: { message: "A deployment is already in progress" },
			},
		}),
	);
	mount();
	await fillDescription("Go live");
	fireEvent.click(button("Promote"));

	await until(() =>
		expect(document.body.textContent).toContain("A deployment is already in progress"),
	);
});

test("success fires confetti once", async () => {
	spyOn(toast, "success").mockImplementation((() => "") as never);
	deploy().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
	poll().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
	mount();
	await fillDescription("Go live");
	fireEvent.click(button("Promote"));

	await until(() => expect(confettiMock).toHaveBeenCalledTimes(1));
});

test("rollback does not fire confetti", async () => {
	spyOn(toast, "success").mockImplementation((() => "") as never);
	const start = deploy().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
	poll().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
	mount(3, 2);
	await until(() => expect(button("Roll back")).toBeTruthy());
	await fillDescription("Rolling back");
	fireEvent.click(button("Roll back"));

	await until(() => expect(start).toHaveBeenCalled());
	expect(confettiMock).not.toHaveBeenCalled();
});

test("failed gate does not fire confetti", async () => {
	deploy().mockResolvedValue(deployment() as never);
	poll().mockResolvedValue(
		deployment({
			status: "failed",
			gates: [
				{ gate: "compile", status: "passed", message: "The version compiles" },
				{
					gate: "tests",
					status: "failed",
					message: "1 suite failed",
					items: ["Orders suite: expected 200, got 500"],
				},
			],
		}) as never,
	);
	mount();
	await fillDescription("Go live");
	fireEvent.click(button("Promote"));

	await until(() => expect(document.body.textContent).toContain("could not go live"));
	expect(confettiMock).not.toHaveBeenCalled();
});

test("reduced motion does not fire confetti", async () => {
	const matchMediaSpy = spyOn(window, "matchMedia").mockReturnValue({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {},
	} as never);
	try {
		spyOn(toast, "success").mockImplementation((() => "") as never);
		deploy().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
		poll().mockResolvedValue(deployment({ status: "live", gates: GATES }) as never);
		mount();
		await fillDescription("Go live");
		fireEvent.click(button("Promote"));

		await until(() => expect(document.body.textContent).toContain("v2 is live in production"));
		expect(confettiMock).not.toHaveBeenCalled();
	} finally {
		matchMediaSpy.mockRestore();
	}
});
