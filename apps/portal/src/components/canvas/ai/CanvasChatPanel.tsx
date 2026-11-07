import { Button, Spinner } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	TbArrowsMaximize,
	TbChevronsRight,
	TbLayoutSidebarLeftExpand,
	TbPlugConnected,
	TbPlus,
	TbSparkles,
} from "react-icons/tb";
import { useAgentModel } from "@/components/ai/AgentModel";
import { AgentPickers } from "@/components/ai/AgentPickers";
import { ConversationView } from "@/components/ai/ConversationPage";
import { PromptEditor } from "@/components/ai/PromptEditor";
import { StatusDot } from "@/components/ai/StatusDot";
import { queueMessage } from "@/components/ai/useAgentConversation";
import { getTimeAgo } from "@/lib/datetime";
import { showErrorNotification } from "@/lib/errorNotifier";
import { agentConversationsQuery } from "@/query/agentConversationsQuery";
import type { Effort, Mode } from "@/services/agentConversations";
import { PanelResizeHandle } from "../panel/PanelResizeHandle";
import { useBlockPanelResize } from "../panel/useBlockPanelResize";
import { type CanvasChat, useCanvasAi } from "./CanvasAiContext";
import "../panel/panel.css";

export const CHAT_PANEL_WIDTH_KEY = "fx-ai-chat-panel-width";

/**
 * The agent chat beside the canvas (#754), a side panel like Diagnostics: the
 * same conversation as the AI page, the project's chats behind the toggle at
 * the top left, and "Open in AI page" to carry on full size.
 */
export function CanvasChatPanel() {
	const ai = useCanvasAi();
	const chat = ai?.chat;
	const isOpen = !!chat?.isOpen;
	const [showList, setShowList] = useState(false);
	const resize = useBlockPanelResize({ storageKey: CHAT_PANEL_WIDTH_KEY, onClose: chat?.close });
	if (!ai || !chat) return null;
	const { projectId } = ai;

	return (
		<aside
			className={`fx-panel${isOpen ? " fx-panel--open" : ""}${resize.isResizing ? " fx-panel--resizing" : ""}`}
			style={{ width: isOpen ? `${resize.width}px` : 0 }}
			aria-label="AI chat"
			aria-hidden={!isOpen}
		>
			{isOpen && <PanelResizeHandle label="Resize AI chat panel" resize={resize} />}
			<header className="fx-panel__header">
				<button
					type="button"
					className="fx-panel__close"
					title="Conversations"
					aria-label="Conversations"
					aria-pressed={showList}
					onClick={() => setShowList((s) => !s)}
				>
					<TbLayoutSidebarLeftExpand />
				</button>
				<span className="fx-panel__icon text-accent">
					<TbSparkles size={18} />
				</span>
				<span className="fx-panel__name">AI chat</span>
				<div className="ml-auto flex items-center gap-1">
					<Button
						isIconOnly
						size="sm"
						variant="ghost"
						aria-label="New chat"
						onPress={() => {
							setShowList(false);
							chat.open();
						}}
					>
						<TbPlus size={16} />
					</Button>
					{chat.conversationId && (
						<Link
							to="/$projectId/ai/$conversationId"
							params={{ projectId, conversationId: chat.conversationId }}
							aria-label="Open in AI page"
							title="Open in AI page"
							className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
						>
							<TbArrowsMaximize size={16} />
						</Link>
					)}
					<button
						type="button"
						className="fx-panel__close"
						title="Collapse panel"
						aria-label="Collapse AI chat panel"
						onClick={chat.close}
					>
						<TbChevronsRight />
					</button>
				</div>
			</header>
			{isOpen && (
				<div className="relative min-h-0 flex-1 overflow-hidden">
					{chat.conversationId ? (
						<ConversationView
							key={chat.conversationId}
							projectId={projectId}
							conversationId={chat.conversationId}
						/>
					) : (
						<NewCanvasChat key={chat.draftSeq} projectId={projectId} chat={chat} />
					)}
					{/* the list slides over the left 40%; the dimmed rest closes it */}
					{showList && (
						<button
							type="button"
							aria-label="Close conversations"
							className="absolute inset-0 z-10 cursor-default bg-background/50"
							onClick={() => setShowList(false)}
						/>
					)}
					<div
						className={`absolute inset-y-0 left-0 z-20 w-2/5 border-r border-border bg-background shadow-lg transition-transform duration-200 ${showList ? "translate-x-0" : "-translate-x-full"}`}
						inert={!showList}
					>
						<Conversations
							projectId={projectId}
							current={chat.conversationId}
							onOpen={(id) => {
								chat.setConversation(id);
								setShowList(false);
							}}
						/>
					</div>
				</div>
			)}
		</aside>
	);
}

/** The project's chats (not archived), newest first; the one shown is marked. */
function Conversations({
	projectId,
	current,
	onOpen,
}: {
	projectId: string;
	current?: string;
	onOpen: (id: string) => void;
}) {
	const { data, isLoading } = agentConversationsQuery.list.useQuery(projectId);
	const chats = (data ?? []).filter((c) => !c.archived);
	if (isLoading)
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	if (!chats.length)
		return <p className="p-4 text-center text-xs text-muted">No conversations yet.</p>;
	return (
		<ul aria-label="Conversations" className="flex h-full flex-col gap-1 overflow-y-auto p-2">
			{chats.map((c) => (
				<li key={c.id}>
					<button
						type="button"
						aria-current={c.id === current ? "true" : undefined}
						onClick={() => onOpen(c.id)}
						className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-secondary ${c.id === current ? "bg-accent/10" : ""}`}
					>
						<span className="w-full truncate text-foreground" title={c.title ?? undefined}>
							{c.title ?? "Untitled session"}
						</span>
						<span className="flex items-center gap-1.5 text-[11px] text-muted">
							<StatusDot status={c.status} />
							{getTimeAgo(c.updatedAt)}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

/** The first message of a new chat; the conversation view sends it once the chat exists. */
function NewCanvasChat({ projectId, chat }: { projectId: string; chat: CanvasChat }) {
	const [query, setQuery] = useState(chat.draft);
	const [mode, setMode] = useState<Mode>("manual");
	const [effort, setEffort] = useState<Effort>("none");
	const model = agentConversationsQuery.model.useQuery(projectId);
	const { isLoading, missing } = useAgentModel(projectId);
	const create = agentConversationsQuery.create.mutation(projectId);

	if (isLoading)
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	if (missing)
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted">
				<p>Pick the AI connection the agent runs on in the project's AI settings.</p>
				<Link
					to="/$projectId/settings"
					params={{ projectId }}
					search={{ tab: "ai-connections" }}
					className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90"
				>
					<TbPlugConnected size={16} />
					Open AI settings
				</Link>
			</div>
		);

	const submit = (q: string, mentions?: string[]) =>
		create.mutate(q.split("\n")[0].slice(0, 80), {
			onSuccess: (conversation) => {
				queueMessage(conversation.id, q, { mode, effort, mentions });
				chat.setConversation(conversation.id);
			},
			onError: (err) => showErrorNotification(err),
		});

	return (
		<div className="flex h-full flex-col justify-end gap-2 p-3">
			<p className="px-1 text-center text-xs text-muted">
				Ask the agent about this canvas, or to change it.
			</p>
			<PromptEditor
				projectId={projectId}
				value={query}
				onChange={setQuery}
				onSubmit={submit}
				isPending={create.isPending}
				minRows={2}
				controls={
					<AgentPickers
						mode={mode}
						onModeChange={setMode}
						effort={effort}
						onEffortChange={setEffort}
						supportsThinking={model.data?.supportsThinking ?? false}
					/>
				}
			/>
		</div>
	);
}
