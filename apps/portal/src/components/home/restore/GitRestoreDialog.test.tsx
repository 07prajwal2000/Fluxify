import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { ArchiveSummary } from "@/services/projects";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// opening the restored project navigates; a Link needs a router, so both are stubbed
const navigate = mock((_: unknown) => {});
const router = { ...(await import("@tanstack/react-router")) };
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

const { AxiosError } = await import("axios");
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { projectsService } = await import("@/services/projects");
const { NewProjectButton } = await import("./NewProjectButton");

afterEach(cleanup);
afterAll(() => {
	GlobalRegistrator.unregister();
	mock.module("@tanstack/react-router", () => router);
});
beforeEach(() => {
	mock.restore();
	navigate.mockClear();
});

async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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

const SUMMARY: ArchiveSummary = {
	mode: "backup",
	release: "2026.11.1",
	createdAt: "2026-11-10T02:00:00.000Z",
	source: { name: "Shop", slug: "shop" },
	sections: { routes: 1 },
	encrypted: true,
	readme: null,
	warnings: [],
	preview: [{ section: "routes", items: [] }],
	suggested: { name: "Shop (2)", slug: "shop-2" },
};
const TIP = {
	sha: "a".repeat(40),
	message: "newest",
	author: "Ann",
	date: "2026-11-12T00:00:00.000Z",
};
const OLDER = {
	sha: "b".repeat(40),
	message: "older",
	author: "Ann",
	date: "2026-11-10T00:00:00.000Z",
};
const REPO = { url: "https://git.example.com/team/backups.git", branch: "main", path: "shop" };

function setup() {
	const { baseElement } = render(
		<QueryClientProvider client={new QueryClient()}>
			<NewProjectButton />
		</QueryClientProvider>,
	);
	const text = () => baseElement.textContent ?? "";
	const button = (name: string) => {
		const found = [...baseElement.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === name,
		);
		if (!found) throw new Error(`no ${name}`);
		return found as HTMLButtonElement;
	};
	const field = (label: string) => {
		const l = [...baseElement.querySelectorAll("label")].find((x) => x.textContent === label);
		const input = l && baseElement.querySelector(`#${CSS.escape(l.htmlFor)}`);
		if (!input) throw new Error(`no field ${label}`);
		return input as HTMLInputElement;
	};
	const radio = (name: string) => {
		const found = [...baseElement.querySelectorAll('[role="radio"]')].find((r) =>
			r.textContent?.includes(name),
		);
		if (!found) throw new Error(`no commit ${name}`);
		return found as HTMLElement;
	};
	return { baseElement, text, button, field, radio };
}

const click = (el: HTMLElement) =>
	act(async () => {
		fireEvent.click(el);
	});
const type = (input: HTMLInputElement, value: string) =>
	act(async () => {
		fireEvent.change(input, { target: { value } });
	});

async function openDialog(ui: ReturnType<typeof setup>) {
	await click(ui.baseElement.querySelector('button[aria-label="More ways to create a project"]')!);
	const item = await until(() => {
		const found = [...ui.baseElement.querySelectorAll('[role="menuitem"]')].find(
			(el) => el.textContent?.trim() === "Restore from a git repository",
		);
		if (!found) throw new Error("no menu item");
		return found as HTMLElement;
	});
	await click(item);
	await until(() => ui.field("Repository URL"));
}

test("dropdown → repository → commit (the tip by default) → preview → new project", async () => {
	const commits = spyOn(projectsService, "gitCommits").mockResolvedValue([TIP, OLDER]);
	const inspect = spyOn(projectsService, "inspectGit").mockResolvedValue(SUMMARY);
	const restore = spyOn(projectsService, "restoreGit").mockResolvedValue({
		id: "p9",
		warnings: [],
	});
	const ui = setup();
	await openDialog(ui);

	expect(ui.button("Find commits").disabled).toBe(true);
	await type(ui.field("Repository URL"), REPO.url);
	await type(ui.field("Folder"), REPO.path);
	await type(ui.field("Token"), "read-token");
	await click(ui.button("Find commits"));
	await until(() => expect(ui.radio("newest").getAttribute("aria-checked")).toBe("true"));
	// a public repo leaves the username out; the token goes with the request only
	expect(commits).toHaveBeenCalledWith({ ...REPO, username: undefined, token: "read-token" });

	await click(ui.radio("older"));
	expect(ui.radio("older").getAttribute("aria-checked")).toBe("true");
	await click(ui.button("Continue"));

	await until(() => expect(ui.field("Project name").value).toBe("Shop (restored 2026-11-10)"));
	expect(inspect).toHaveBeenCalledWith(
		{ ...REPO, username: undefined, token: "read-token" },
		OLDER.sha,
	);
	await click(ui.button("Create project"));
	await until(() =>
		expect(navigate).toHaveBeenCalledWith({ to: "/$projectId", params: { projectId: "p9" } }),
	);
	expect(restore.mock.calls[0]?.[1]).toBe(OLDER.sha);
	expect(restore.mock.calls[0]?.[2]).toMatchObject({ name: "Shop (restored 2026-11-10)" });
});

test("shows the server's plain-words refusal, and asks again after the repository changes", async () => {
	spyOn(projectsService, "gitCommits").mockRejectedValue(
		new AxiosError("Bad", "ERR_BAD_REQUEST", undefined, undefined, {
			status: 400,
			data: {
				message: "There is no repository at …, or it is private: add a token with read access.",
			},
		} as never),
	);
	const ui = setup();
	await openDialog(ui);
	await type(ui.field("Repository URL"), REPO.url);
	await click(ui.button("Find commits"));
	await until(() => expect(ui.text()).toContain("it is private: add a token"));
	await type(ui.field("Token"), "t");
	expect(ui.text()).not.toContain("it is private: add a token");
	expect(ui.button("Find commits")).toBeTruthy();
});
