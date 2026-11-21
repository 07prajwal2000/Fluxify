import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { GitSettingsView } from "@/services/backups";
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

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { backupsService } = await import("@/services/backups");
const { appConfigService } = await import("@/services/appConfig");
const { authStore } = await import("@/store/auth");
const { GitBackup } = await import("./GitBackup");

afterEach(cleanup);
afterAll(() => {
	GlobalRegistrator.unregister();
	mock.module("@tanstack/react-router", () => router);
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

const SAVED: GitSettingsView = {
	settings: {
		url: "https://git.example.com/team/backups.git",
		branch: "main",
		path: "shop",
		username: "cfg:GIT_USER",
		token: "cfg:GIT_TOKEN",
		encryptSecrets: true,
	},
};

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
const COMMIT = {
	sha: "a".repeat(40),
	message: "nightly\n\nmore",
	author: "Ann",
	date: "2026-11-10T02:00:00.000Z",
};

beforeEach(() => {
	mock.restore();
	navigate.mockClear();
	authStore.getState().actions.setUserData({ id: "u", name: "", email: "", isSystemAdmin: true });
	spyOn(backupsService, "gitCommits").mockResolvedValue([COMMIT]);
	// the key pickers list app config; no server here
	spyOn(appConfigService, "getAll").mockResolvedValue({ data: [], totalCount: 0 } as never);
});

function setup(view: GitSettingsView = SAVED) {
	spyOn(backupsService, "gitSettings").mockResolvedValue(view);
	const { baseElement } = render(
		<QueryClientProvider client={new QueryClient()}>
			<GitBackup projectId="p1" history={[]} />
		</QueryClientProvider>,
	);
	const ui = within(baseElement);
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
	return { ui, text, button, field };
}

const type = (input: HTMLInputElement, value: string) =>
	act(async () => {
		fireEvent.change(input, { target: { value } });
	});

test("warns that http:// sends the token in cleartext, and when secrets go unencrypted", async () => {
	const { text, field, ui } = setup();
	await until(() => field("Repository URL"));
	expect(text()).not.toContain("cleartext");
	await type(field("Repository URL"), "http://git.lan/team/backups.git");
	expect(text()).toContain("the token is sent in cleartext");

	await act(async () => {
		fireEvent.click(ui.getByRole("checkbox", { name: /Encrypt secrets/ }));
	});
	expect(text()).toContain("committed as plain text and stay in the repository's history");
});

test("warns that turning encryption on doesn't scrub earlier commits", async () => {
	const { text, ui } = setup({ ...SAVED, settings: { ...SAVED.settings, encryptSecrets: false } });
	const box = await until(() => ui.getByRole("checkbox", { name: /Encrypt secrets/ }));
	expect(text()).not.toContain("Rotate the credentials");
	await act(async () => {
		fireEvent.click(box);
	});
	expect(text()).toContain("doesn't remove secrets from earlier commits");
});

test("saves the settings as typed, with the app config references", async () => {
	const save = spyOn(backupsService, "saveGitSettings").mockResolvedValue(SAVED);
	const { field, button } = setup();
	await until(() => field("Branch"));
	await type(field("Branch"), "backups");
	await act(async () => {
		fireEvent.click(button("Save"));
	});
	await until(() => expect(save).toHaveBeenCalled());
	expect(save.mock.calls[0]?.[1]).toEqual({ ...SAVED.settings, branch: "backups" });
});

test("Save is off for a URL with credentials in it", async () => {
	const { field, button } = setup();
	await until(() => field("Repository URL"));
	await type(field("Repository URL"), "https://me:secret@git.example.com/x.git");
	expect(button("Save").disabled).toBe(true);
});

test("Commit to git asks for a message and sends it", async () => {
	const commit = spyOn(backupsService, "gitCommit").mockResolvedValue({ id: "b1" });
	const { button, field } = setup();
	const open = await until(() => button("Commit to git"));
	await act(async () => {
		fireEvent.click(open);
	});
	const send = await until(() => button("Commit"));
	expect(send.disabled).toBe(true);
	await type(field("Commit message"), "  before the release  ");
	await act(async () => {
		fireEvent.click(button("Commit"));
	});
	await until(() => expect(commit).toHaveBeenCalledWith("p1", "before the release"));
});

test("Commit to git waits until the repository is saved", async () => {
	const { button } = setup({ settings: { ...SAVED.settings, url: "" } });
	expect((await until(() => button("Commit to git"))).disabled).toBe(true);
});

test("restores a listed commit as a new project", async () => {
	const inspect = spyOn(backupsService, "inspectGit").mockResolvedValue(SUMMARY);
	const restore = spyOn(backupsService, "restoreGit").mockResolvedValue({ id: "p9", warnings: [] });
	const { text, button, field } = setup();
	await until(() => expect(text()).toContain("nightly"));
	await act(async () => {
		fireEvent.click(button("Restore"));
	});
	await until(() => expect(field("Project name").value).toBe("Shop (restored 2026-11-10)"));
	expect(inspect).toHaveBeenCalledWith("p1", COMMIT.sha);
	await act(async () => {
		fireEvent.click(button("Create project"));
	});
	await until(() =>
		expect(navigate).toHaveBeenCalledWith({ to: "/$projectId", params: { projectId: "p9" } }),
	);
	expect(restore.mock.calls[0]?.[1]).toBe(COMMIT.sha);
});

test("only a system admin can restore", async () => {
	authStore.getState().actions.setUserData({ id: "u", name: "", email: "", isSystemAdmin: false });
	const { text, button } = setup();
	await until(() => expect(text()).toContain("nightly"));
	expect(button("Restore").disabled).toBe(true);
});

test("the folder starts empty (the repository's root), not the project's slug", async () => {
	const { field } = setup({ settings: { ...SAVED.settings, url: "", path: "" } });
	expect((await until(() => field("Folder"))).value).toBe("");
});

test("a typed username and token are sent as typed; a masked token is sent back unchanged", async () => {
	const save = spyOn(backupsService, "saveGitSettings").mockResolvedValue(SAVED);
	const typed = { ...SAVED, settings: { ...SAVED.settings, username: "ann", token: "********" } };
	const { field, button } = setup(typed);
	await until(() => field("Branch"));
	const inputs = () =>
		[...document.body.querySelectorAll("input:not([type=checkbox])")] as HTMLInputElement[];
	// URL, Branch, Folder, then the two credential fields
	expect(inputs()[3]!.value).toBe("ann");
	expect(inputs()[4]!.value).toBe("********");
	await act(async () => {
		fireEvent.click(button("Save"));
	});
	await until(() => expect(save).toHaveBeenCalledTimes(1));
	expect(save.mock.calls[0]?.[1]).toMatchObject({ username: "ann", token: "********" });

	await type(inputs()[4]!, "new-token");
	await act(async () => {
		fireEvent.click(button("Save"));
	});
	await until(() => expect(save).toHaveBeenCalledTimes(2));
	expect(save.mock.calls[1]?.[1]).toMatchObject({ token: "new-token" });
});
