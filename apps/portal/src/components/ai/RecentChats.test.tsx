import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AgentConversation } from "./types";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RecentChats } = await import("./RecentChats");
const { agentConversationsService } = await import("@/services/agentConversations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

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

const chat = (id: string, over: Partial<AgentConversation> = {}): AgentConversation => ({
	id,
	title: `Chat ${id}`,
	status: "idle",
	pinned: false,
	archived: false,
	createdAt: new Date().toISOString(),
	updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
	...over,
});

function show(list: AgentConversation[]) {
	const read = spyOn(agentConversationsService, "list").mockResolvedValue(list);
	const onOpen = mock((_id: string) => {});
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RecentChats projectId="p1" onOpen={onOpen} />
		</QueryClientProvider>,
	);
	return { view, onOpen, read };
}

test("the three latest chats that are not archived, with title, time and a badge when something needs the user", async () => {
	const { view, onOpen, read } = show([
		chat("a", { status: "paused_hitl" }),
		chat("gone", { archived: true }),
		chat("b", { status: "failed" }),
		chat("c", { status: "interrupted" }),
		chat("d"),
	]);
	await until(() => expect(view.getByText("Chat a")).toBeTruthy());
	expect(view.getAllByRole("button").map((b) => b.textContent)).toEqual([
		"Chat aWaiting for approval5 minutes ago",
		"Chat bFailed5 minutes ago",
		"Chat cInterrupted5 minutes ago",
	]);
	expect(view.queryByText("Chat gone")).toBeNull();
	expect(view.queryByText("Chat d")).toBeNull();
	expect(read).toHaveBeenCalledWith("p1");
	fireEvent.click(view.getByText("Chat b"));
	expect(onOpen).toHaveBeenCalledWith("b");
	read.mockRestore();
});

test("a chat that is just idle or done has no badge", async () => {
	const { view, read } = show([chat("a", { status: "completed" })]);
	await until(() => expect(view.getByText("Chat a")).toBeTruthy());
	expect(view.queryByText("Failed")).toBeNull();
	expect(view.queryByText("Waiting for approval")).toBeNull();
	read.mockRestore();
});

test("with no conversations, nothing shows", async () => {
	const { view, read } = show([chat("old", { archived: true })]);
	await until(() => expect(read).toHaveBeenCalled());
	await act(() => new Promise((r) => setTimeout(r, 30)));
	expect(view.container.innerHTML).toBe("");
	read.mockRestore();
});
