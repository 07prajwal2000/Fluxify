import { Button, CloseButton, Spinner } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TbArrowsMaximize, TbPlugConnected, TbPlus } from "react-icons/tb";
import { useAgentModel } from "@/components/ai/AgentModel";
import { AgentPickers } from "@/components/ai/AgentPickers";
import { ConversationView } from "@/components/ai/ConversationPage";
import { PromptEditor } from "@/components/ai/PromptEditor";
import { queueMessage } from "@/components/ai/useAgentConversation";
import { showErrorNotification } from "@/lib/errorNotifier";
import { agentConversationsQuery } from "@/query/agentConversationsQuery";
import type { Effort, Mode } from "@/services/agentConversations";
import { type CanvasChat, useCanvasAi } from "./CanvasAiContext";

/**
 * The agent chat over the canvas (#754): the same conversation as the AI page,
 * in a small panel above the AI button. A new chat starts from the prompt;
 * "Open in AI page" carries on full size.
 */
export function CanvasChatPanel() {
	const ai = useCanvasAi();
	if (!ai?.chat.isOpen) return null;
	const { projectId, chat } = ai;
	return (
		<section
			aria-label="AI chat"
			className="absolute right-4 bottom-16 z-40 flex h-[min(36rem,70vh)] w-[min(26rem,calc(100%-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
		>
			<header className="flex items-center gap-1 border-b border-border py-1 pr-1 pl-3">
				<span className="text-xs font-medium text-foreground">AI chat</span>
				<div className="ml-auto flex items-center gap-0.5">
					<Button
						isIconOnly
						size="sm"
						variant="ghost"
						aria-label="New chat"
						onPress={() => chat.open()}
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
					<CloseButton aria-label="Close AI chat" onPress={chat.close} />
				</div>
			</header>
			<div className="min-h-0 flex-1">
				{chat.conversationId ? (
					<ConversationView
						key={chat.conversationId}
						projectId={projectId}
						conversationId={chat.conversationId}
					/>
				) : (
					<NewCanvasChat key={chat.draftSeq} projectId={projectId} chat={chat} />
				)}
			</div>
		</section>
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
				maxRows={8}
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
