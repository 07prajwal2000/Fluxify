import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
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
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { sandboxesService } = await import("@/services/sandboxes");
const { SandboxList } = await import("./SandboxList");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const mine = [
	{
		id: "s1",
		projectId: "p1",
		name: "Orders scratch",
		settings: { tracingEnabled: false },
		createdAt: "2026-10-10T10:00:00.000Z",
		updatedAt: "2026-10-10T11:00:00.000Z",
	},
];

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

function renderList(onOpen = mock()) {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<SandboxList projectId="p1" onOpen={onOpen} />
		</QueryClientProvider>,
	);
	return onOpen;
}

const body = () => document.body;
const button = (name: string | RegExp) => {
	const found = [...body().querySelectorAll("button")].find((b) =>
		typeof name === "string"
			? b.getAttribute("aria-label") === name || b.textContent?.trim() === name
			: name.test(b.getAttribute("aria-label") ?? "") || name.test(b.textContent ?? ""),
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
};

beforeEach(() => setRole("creator"));

test("an empty project explains what a sandbox is", async () => {
	spyOn(sandboxesService, "list").mockResolvedValue([]);
	renderList();
	const text = await until(() => {
		const found = body().textContent ?? "";
		if (!found.includes("No sandboxes yet")) throw new Error("not yet");
		return found;
	});
	expect(text).toContain("A sandbox is a private canvas");
});

test("creating a sandbox sends the typed name and opens it", async () => {
	spyOn(sandboxesService, "list").mockResolvedValue([]);
	const create = spyOn(sandboxesService, "create").mockResolvedValue({ id: "new1" });
	const onOpen = renderList();
	await until(() => button("New sandbox"));
	fireEvent.click(button("New sandbox"));

	const input = await until(() => {
		const el = body().querySelector("input[placeholder]") as HTMLInputElement | null;
		if (!el) throw new Error("no dialog");
		return el;
	});
	fireEvent.change(input, { target: { value: "  Try joins " } });
	fireEvent.click(button("Create"));

	await until(() => expect(create).toHaveBeenCalledWith("p1", { name: "Try joins" }));
	await until(() => expect(onOpen).toHaveBeenCalledWith("new1"));
});

test("renaming sends the new name for that sandbox", async () => {
	spyOn(sandboxesService, "list").mockResolvedValue(mine);
	const update = spyOn(sandboxesService, "update").mockResolvedValue({
		...mine[0],
		name: "Renamed",
	});
	renderList();
	await until(() => button("Rename Orders scratch"));
	fireEvent.click(button("Rename Orders scratch"));

	const input = await until(() => {
		const el = body().querySelector("input[placeholder]") as HTMLInputElement | null;
		if (!el) throw new Error("no dialog");
		return el;
	});
	expect(input.value).toBe("Orders scratch");
	fireEvent.change(input, { target: { value: "Renamed" } });
	fireEvent.click(button("Rename"));

	await until(() => expect(update).toHaveBeenCalledWith("p1", "s1", { name: "Renamed" }));
});

test("deleting asks first, then calls the API", async () => {
	spyOn(sandboxesService, "list").mockResolvedValue(mine);
	const remove = spyOn(sandboxesService, "delete").mockResolvedValue(undefined);
	renderList();
	await until(() => button("Delete Orders scratch"));
	fireEvent.click(button("Delete Orders scratch"));

	await until(() => button("Delete"));
	expect(remove).not.toHaveBeenCalled();
	fireEvent.click(button("Delete"));

	await until(() => expect(remove).toHaveBeenCalledWith("p1", "s1"));
});

test("a viewer gets no list, and no request for one is the page's business", async () => {
	setRole("viewer");
	spyOn(sandboxesService, "list").mockResolvedValue(mine);
	renderList();
	await until(() => expect(body().textContent).toContain("for creators and above"));
	expect(body().textContent).not.toContain("New sandbox");
});
