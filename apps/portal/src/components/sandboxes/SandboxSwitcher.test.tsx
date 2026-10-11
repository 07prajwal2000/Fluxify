import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const router = await import("@tanstack/react-router");
const nav = mock();
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => nav,
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { sandboxesService } = await import("@/services/sandboxes");
const { SandboxSwitcher } = await import("./SandboxSwitcher");

afterEach(() => {
	cleanup();
	nav.mockReset();
});
afterAll(() => GlobalRegistrator.unregister());

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

const sandboxes = [
	{
		id: "s1",
		projectId: "p1",
		name: "Orders scratch",
		settings: { tracingEnabled: false },
		createdAt: "2026-10-10T10:00:00.000Z",
		updatedAt: "2026-10-10T11:00:00.000Z",
	},
	{
		id: "s2",
		projectId: "p1",
		name: "Payments scratch",
		settings: { tracingEnabled: false },
		createdAt: "2026-10-10T12:00:00.000Z",
		updatedAt: "2026-10-10T13:00:00.000Z",
	},
];

function renderSwitcher(sandboxId = "s1") {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<SandboxSwitcher projectId="p1" sandboxId={sandboxId} />
		</QueryClientProvider>,
	);
}

test("SandboxSwitcher: shows current sandbox, back button navigates to sandboxes list", async () => {
	const listSpy = spyOn(sandboxesService, "list").mockResolvedValue(sandboxes as any);
	const getSpy = spyOn(sandboxesService, "getById").mockResolvedValue(sandboxes[0] as any);

	const view = renderSwitcher("s1");

	await until(() => expect(view.container.textContent).toContain("Orders scratch"));
	expect(view.container.textContent).toContain("Sandboxes");

	const backBtn = view.getByRole("button", { name: "Back to Sandboxes" });
	fireEvent.click(backBtn);
	expect(nav).toHaveBeenCalledWith({
		to: "/$projectId/sandboxes",
		params: { projectId: "p1" },
	});

	listSpy.mockRestore();
	getSpy.mockRestore();
});

test("SandboxSwitcher: next/previous buttons navigate between sandboxes", async () => {
	const listSpy = spyOn(sandboxesService, "list").mockResolvedValue(sandboxes as any);
	const getSpy = spyOn(sandboxesService, "getById").mockResolvedValue(sandboxes[0] as any);

	const view = renderSwitcher("s1");

	await until(() => expect(view.container.textContent).toContain("Orders scratch"));

	const prevBtn = view.getByRole("button", { name: "Previous sandbox" });
	expect((prevBtn as HTMLButtonElement).disabled).toBe(true);

	const nextBtn = view.getByRole("button", { name: "Next sandbox" });
	expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

	fireEvent.click(nextBtn);
	expect(nav).toHaveBeenCalledWith({
		to: "/$projectId/sandbox-canvas/$sandboxId",
		params: { projectId: "p1", sandboxId: "s2" },
	});

	listSpy.mockRestore();
	getSpy.mockRestore();
});
