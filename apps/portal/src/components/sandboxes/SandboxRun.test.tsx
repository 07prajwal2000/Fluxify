import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
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
const { AxiosError } = await import("axios");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { sandboxesService } = await import("@/services/sandboxes");
const { DevWorkerBanner } = await import("./DevWorkerBanner");
const { SandboxRunButton, SandboxRunModal } = await import("./SandboxRunModal");
const { DEV_WORKER_MESSAGE } = await import("./sandboxRequest");

afterEach(() => {
	cleanup();
	mock.restore();
});
afterAll(() => GlobalRegistrator.unregister());

authStore.setState((s) => {
	s.state.acl = { p1: "creator" };
	s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
});

const withClient = (ui: React.ReactElement) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{ui}
		</QueryClientProvider>,
	);
const runButton = () =>
	[...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run") as
		| HTMLButtonElement
		| undefined;

function conflict() {
	return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
		status: 409,
		statusText: "Conflict",
		headers: {},
		config: {} as never,
		data: { message: "start a worker with FLUXIFY_ENV=development" },
	});
}

test("a 409 from Run shows the dev worker message in the dialog", async () => {
	const run = spyOn(sandboxesService, "run").mockRejectedValue(conflict());
	withClient(
		<SandboxRunModal
			projectId="p1"
			sandboxId="s1"
			name="Scratch"
			online
			isOpen
			onOpenChange={() => {}}
		/>,
	);

	const button = await until(() => {
		const found = runButton();
		if (!found) throw new Error("no run button");
		return found;
	});
	fireEvent.click(button);

	await until(() => expect(run).toHaveBeenCalledWith("p1", "s1", undefined));
	await until(() =>
		expect(document.body.textContent).toContain("start a worker with FLUXIFY_ENV=development"),
	);
});

test("the payload is sent as JSON when it parses", async () => {
	const run = spyOn(sandboxesService, "run").mockResolvedValue({ id: "r1", accepted: true });
	withClient(
		<SandboxRunModal
			projectId="p1"
			sandboxId="s1"
			name="Scratch"
			online
			isOpen
			onOpenChange={() => {}}
		/>,
	);
	const box = await until(() => {
		const el = document.body.querySelector("textarea");
		if (!el) throw new Error("no textarea");
		return el;
	});
	fireEvent.change(box, { target: { value: '{"day": 1}' } });
	fireEvent.click(runButton() as HTMLButtonElement);
	await until(() => expect(run).toHaveBeenCalledWith("p1", "s1", { day: 1 }));
});

test("no dev worker: the banner shows and Run is off in the button and the dialog", async () => {
	const banner = render(<DevWorkerBanner online={false} />);
	expect(banner.container.textContent).toContain(DEV_WORKER_MESSAGE);
	cleanup();
	expect(render(<DevWorkerBanner online />).container.textContent).toBe("");
	cleanup();

	const button = withClient(
		<SandboxRunButton projectId="p1" online={false} onPress={() => {}} />,
	).getByRole("button", { name: "Run" });
	expect(button.hasAttribute("disabled")).toBe(true);
	cleanup();

	withClient(
		<SandboxRunModal
			projectId="p1"
			sandboxId="s1"
			name="Scratch"
			online={false}
			isOpen
			onOpenChange={() => {}}
		/>,
	);
	await until(() => {
		if (!runButton()) throw new Error("no run button");
	});
	expect(runButton()?.hasAttribute("disabled")).toBe(true);
	expect(document.body.textContent).toContain(DEV_WORKER_MESSAGE);
});
