import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { versionsService } = await import("@/services/versions");
const { CheckoutDialog } = await import("./CheckoutDialog");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
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

const VERSION = {
	id: "ver-3",
	kind: "route",
	targetId: "r1",
	versionNumber: 3,
	title: "Add auth",
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: "ver-2",
	isHead: false,
};

function renderDialog(uncommitted: boolean) {
	const onClose = mock(() => undefined);
	const onCheckedOut = mock(() => undefined);
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CheckoutDialog
				kind="route"
				id="r1"
				version={VERSION as never}
				uncommitted={uncommitted}
				onClose={onClose}
				onCheckedOut={onCheckedOut}
			/>
		</QueryClientProvider>,
	);
	return { view, onClose, onCheckedOut };
}

const button = (name: string) => {
	const found = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
};

const titleInput = () => document.body.querySelector("input") as HTMLInputElement | null;

test("with nothing uncommitted there is no title to ask for", async () => {
	const checkout = spyOn(versionsService, "checkout").mockResolvedValue({
		checkedOut: VERSION,
		canvasRevision: 5,
		warnings: [],
	} as never);
	const success = spyOn(toast, "success").mockImplementation((() => "") as never);
	const { onCheckedOut, onClose } = renderDialog(false);
	await until(() => button("Check out"));
	expect(titleInput()).toBeNull();
	expect(document.body.textContent).not.toContain("saved as a new version first");

	fireEvent.click(button("Check out"));
	await until(() => expect(checkout).toHaveBeenCalled());
	expect(checkout).toHaveBeenCalledWith("route", "r1", "ver-3", { title: undefined });
	await until(() => expect(success).toHaveBeenCalledWith("Checked out v3"));
	expect(success).toHaveBeenCalledTimes(1);
	await until(() => expect(onCheckedOut).toHaveBeenCalled());
	expect(onClose).toHaveBeenCalled();
});

test("uncommitted work explains itself and asks for a title, prefilled", async () => {
	spyOn(versionsService, "checkout").mockResolvedValue({
		savedVersion: { ...VERSION, versionNumber: 5 },
		checkedOut: VERSION,
		canvasRevision: 9,
		warnings: [],
	} as never);
	renderDialog(true);
	await until(() => button("Check out"));

	expect(document.body.textContent).toContain("saved as a new version first, so nothing is lost");
	expect(titleInput()?.value).toBe("Saved before checking out v3");
});

test("posts the version and the title, and says where the saved work went", async () => {
	const checkout = spyOn(versionsService, "checkout").mockResolvedValue({
		savedVersion: { ...VERSION, versionNumber: 5 },
		checkedOut: VERSION,
		canvasRevision: 9,
		warnings: ["A middleware was deleted and is left out"],
	} as never);
	const success = spyOn(toast, "success").mockImplementation((() => "") as never);
	const warning = spyOn(toast, "warning").mockImplementation((() => "") as never);
	const { onCheckedOut } = renderDialog(true);
	await until(() => button("Check out"));

	fireEvent.change(titleInput() as HTMLInputElement, {
		target: { value: "  Before going back  " },
	});
	fireEvent.click(button("Check out"));

	await until(() => expect(checkout).toHaveBeenCalled());
	expect(checkout).toHaveBeenCalledWith("route", "r1", "ver-3", { title: "Before going back" });
	await until(() => expect(success).toHaveBeenCalledWith("Saved your work as v5"));
	expect(success).toHaveBeenCalledWith("Checked out v3");
	expect(warning).toHaveBeenCalledWith("A middleware was deleted and is left out");
	await until(() => expect(onCheckedOut).toHaveBeenCalled());
});

test("a path clash shows the server's message and stays open", async () => {
	const error = Object.assign(new Error("Request failed with status code 409"), {
		isAxiosError: true,
		response: {
			status: 409,
			data: { message: "GET /orders now belongs to another route" },
		},
	});
	spyOn(versionsService, "checkout").mockRejectedValue(error);
	const danger = spyOn(toast, "danger").mockImplementation((() => "") as never);
	const { onCheckedOut, onClose } = renderDialog(false);
	await until(() => button("Check out"));
	fireEvent.click(button("Check out"));

	await until(() =>
		expect(danger).toHaveBeenCalledWith("GET /orders now belongs to another route"),
	);
	expect(onCheckedOut).not.toHaveBeenCalled();
	expect(onClose).not.toHaveBeenCalled();
});
