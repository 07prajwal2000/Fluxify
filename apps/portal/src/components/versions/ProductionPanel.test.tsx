import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

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
	status: "failed",
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
			<ProductionPanel kind="route" id="r1" versions={versions} />
		</QueryClientProvider>,
	);
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
