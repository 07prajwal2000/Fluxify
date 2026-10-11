import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
/** Not RTL's waitFor/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
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
const navigate = mock();
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
}));
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { triggersService } = await import("@/services/triggers");
const { sandboxesService } = await import("@/services/sandboxes");
const { SandboxSettingsModal } = await import("./SandboxSettingsModal");

afterEach(() => {
	cleanup();
	mock.restore();
	navigate.mockClear();
});
afterAll(() => GlobalRegistrator.unregister());

const row = (over: Record<string, unknown>) =>
	({
		id: "t",
		name: "t",
		type: "redis",
		active: true,
		workflowId: null,
		sandboxId: null,
		workflow: null,
		disabledReason: null,
		schedule: null,
		timezone: "UTC",
		...over,
	}) as never;

const attached = row({ id: "t1", name: "orders stream", sandboxId: "s1" });
const free = row({ id: "t2", name: "spare queue" });
const nightly = row({ id: "t3", name: "nightly", type: "schedule", schedule: "@daily" });
const busy = row({ id: "t4", name: "taken", workflowId: "w1" });

function mockList() {
	return spyOn(triggersService, "getAll").mockImplementation(async (query) => ({
		data: query.sandboxId ? [attached] : [attached, free, nightly, busy],
		pagination: { page: 1, totalPages: 1, hasNext: false },
	}));
}

const sandbox = { id: "s1", projectId: "p1", name: "orders", settings: { tracingEnabled: false } };

const mount = (readOnly = false) => {
	spyOn(sandboxesService, "getById").mockResolvedValue(sandbox as never);
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<SandboxSettingsModal
				projectId="p1"
				sandboxId="s1"
				readOnly={readOnly}
				isOpen
				onOpenChange={() => {}}
			/>
		</QueryClientProvider>,
	);
};

/** Open the modal and switch to its Triggers section. */
async function openTriggers(readOnly = false) {
	mount(readOnly);
	const tab = await until(() => {
		const found = [...document.body.querySelectorAll("[role=tab]")].find(
			(t) => t.textContent === "Triggers",
		);
		if (!found) throw new Error("no tab yet");
		return found;
	});
	fireEvent.click(tab);
}

const button = (name: string) =>
	[...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) as
		| HTMLButtonElement
		| undefined;

test("lists the sandbox's triggers, asked for by sandbox id", async () => {
	const list = mockList();
	await openTriggers();
	await until(() => expect(document.body.textContent).toContain("orders stream"));
	expect(list).toHaveBeenCalledWith({ projectId: "p1", sandboxId: "s1" });
	expect(document.body.textContent).toContain("development worker");
});

test("offers only unattached triggers that can run a sandbox, and attaches by patching sandboxId", async () => {
	mockList();
	const update = spyOn(triggersService, "update").mockResolvedValue({} as never);
	await openTriggers();
	const select = await until(() => {
		const el = document.body.querySelector("select");
		if (!el || el.options.length < 2) throw new Error("no options yet");
		return el;
	});
	const offered = [...select.options].map((o) => o.value).filter(Boolean);
	expect(offered).toEqual(["t2"]);

	fireEvent.change(select, { target: { value: "t2" } });
	await until(() => expect(button("Attach")?.hasAttribute("disabled")).toBe(false));
	fireEvent.click(button("Attach") as HTMLButtonElement);
	await until(() => expect(update).toHaveBeenCalledWith("t2", { sandboxId: "s1" }));
});

test("detaching patches sandboxId to null after a confirm", async () => {
	mockList();
	const update = spyOn(triggersService, "update").mockResolvedValue({} as never);
	await openTriggers();
	await until(() => expect(button("Detach")).toBeDefined());
	fireEvent.click(button("Detach") as HTMLButtonElement);
	const dialog = await until(() => {
		const found = [...document.body.querySelectorAll("[role=dialog]")].find((d) =>
			d.textContent?.includes("Detach trigger?"),
		);
		if (!found) throw new Error("no confirm");
		return found as HTMLElement;
	});
	expect(dialog.textContent).toContain("running this sandbox");
	fireEvent.click(within(dialog).getByRole("button", { name: "Detach" }));
	await until(() => expect(update).toHaveBeenCalledWith("t1", { sandboxId: null }));
});

test("read-only: no attach and no detach", async () => {
	mockList();
	await openTriggers(true);
	await until(() => expect(document.body.textContent).toContain("orders stream"));
	expect(button("Attach")).toBeUndefined();
	expect(button("Detach")).toBeUndefined();
});

test("General saves the name and the tracing flag", async () => {
	const update = spyOn(sandboxesService, "update").mockResolvedValue(sandbox as never);
	mount();
	const input = await until(() => {
		const el = document.body.querySelector("input[type=text], input:not([type])");
		if (!el) throw new Error("no name field yet");
		return el as HTMLInputElement;
	});
	fireEvent.change(input, { target: { value: "orders v2" } });
	const box = document.body.querySelector("input[type=checkbox]") as HTMLInputElement;
	fireEvent.click(box);
	await until(() => expect(button("Save changes")?.hasAttribute("disabled")).toBe(false));
	fireEvent.click(button("Save changes") as HTMLButtonElement);
	await until(() =>
		expect(update).toHaveBeenCalledWith("p1", "s1", {
			name: "orders v2",
			settings: { tracingEnabled: true },
		}),
	);
});

test("viewer sees no Danger zone tab", async () => {
	mount(true);
	await until(() => {
		const tabs = [...document.body.querySelectorAll("[role=tab]")];
		if (!tabs.length) throw new Error("no tabs yet");
		return tabs;
	});
	const tabs = [...document.body.querySelectorAll("[role=tab]")];
	expect(tabs.some((t) => t.textContent === "Danger zone")).toBe(false);
});

test("Danger zone opens confirm dialog and deletes sandbox", async () => {
	const remove = spyOn(sandboxesService, "delete").mockResolvedValue(undefined as never);
	mount(false);
	const dangerTab = await until(() => {
		const found = [...document.body.querySelectorAll("[role=tab]")].find(
			(t) => t.textContent === "Danger zone",
		);
		if (!found) throw new Error("no danger tab yet");
		return found;
	});
	fireEvent.click(dangerTab);

	const deleteBtn = await until(() => {
		const btn = button("Delete sandbox");
		if (!btn) throw new Error("no delete sandbox button");
		return btn;
	});
	fireEvent.click(deleteBtn);

	await until(() => {
		expect(document.body.textContent).toContain("Delete sandbox?");
		expect(document.body.textContent).toContain("blocks, triggers and recordings will be deleted");
	});

	const confirmBtn = button("Delete");
	expect(confirmBtn).toBeDefined();
	fireEvent.click(confirmBtn!);

	await until(() => expect(remove).toHaveBeenCalledWith("p1", "s1"));
	await until(() =>
		expect(navigate).toHaveBeenCalledWith({
			to: "/$projectId/sandboxes",
			params: { projectId: "p1" },
		}),
	);
});
