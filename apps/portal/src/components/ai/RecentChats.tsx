import { Chip } from "@fluxify/components";
import { getTimeAgo } from "@/lib/datetime";
import { agentConversationsQuery } from "@/query/agentConversationsQuery";
import { StatusDot } from "./StatusDot";
import type { AgentConversation } from "./types";

const RECENT = 3;

/** The statuses worth a badge on the home page: something needs the user, or went wrong. */
const BADGE: Record<string, { label: string; color: "warning" | "danger" }> = {
	paused_hitl: { label: "Waiting for approval", color: "warning" },
	failed: { label: "Failed", color: "danger" },
	interrupted: { label: "Interrupted", color: "danger" },
};

function Row({ chat, onOpen }: { chat: AgentConversation; onOpen: (id: string) => void }) {
	const badge = BADGE[chat.status];
	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(chat.id)}
				className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-left transition-colors hover:bg-surface-secondary"
			>
				<span className="min-w-0 flex-1 truncate text-sm text-foreground">
					{chat.title ?? "Untitled session"}
				</span>
				{badge ? (
					<Chip size="sm" color={badge.color}>
						{badge.label}
					</Chip>
				) : (
					<StatusDot status={chat.status} />
				)}
				<span className="shrink-0 text-xs text-muted">{getTimeAgo(chat.updatedAt)}</span>
			</button>
		</li>
	);
}

/**
 * The project's three latest conversations (not archived), under the prompt
 * editor of the home page. Reads the list the sidebar reads. Nothing when there are none.
 */
export function RecentChats({
	projectId,
	onOpen,
}: {
	projectId: string;
	onOpen: (conversationId: string) => void;
}) {
	const { data } = agentConversationsQuery.list.useQuery(projectId);
	// the list comes newest first
	const recent = (data ?? []).filter((c) => !c.archived).slice(0, RECENT);
	if (!recent.length) return null;
	return (
		<section aria-label="Recent chats" className="flex flex-col gap-2">
			<h2 className="text-sm font-medium text-muted">Recent chats</h2>
			<ul className="flex flex-col gap-2">
				{recent.map((c) => (
					<Row key={c.id} chat={c} onOpen={onOpen} />
				))}
			</ul>
		</section>
	);
}
