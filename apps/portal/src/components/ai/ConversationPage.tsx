import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { usePageTitle } from "@/lib/seo";
import { AgentMessage, LimitNotice, Thinking } from "./AgentMessage";
import type { ChatMessage } from "./agentMessages";
import { ChatTitleEditor } from "./ChatTitleEditor";
import { PromptEditor } from "./PromptEditor";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { useAgentConversation } from "./useAgentConversation";
import { useScrollToBottom } from "./useScrollToBottom";

/** The model is working without showing anything new: no text streaming, no tool running. */
const isThinking = (messages: ChatMessage[]) => {
	const last = messages.at(-1);
	const tail = last?.parts.at(-1);
	if (last?.role === "assistant" && tail?.type === "text" && tail.text) return false;
	return !(tail?.type === "tool" && tail.output === undefined && tail.error === undefined);
};

export function ConversationPage() {
	const { projectId, conversationId } = useParams({
		from: "/_authed/$projectId/ai/$conversationId",
	});
	const [query, setQuery] = useState("");
	const chat = useAgentConversation(projectId, conversationId);
	const bottomRef = useRef<HTMLDivElement>(null);
	const { isAtBottom, scrollToBottom } = useScrollToBottom(bottomRef, 250);
	const conversation = chat.conversation;

	usePageTitle(
		conversation?.title ? `${conversation.title} | Fluxify AI` : "AI Conversation | Fluxify AI",
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new output while at the bottom
	useEffect(() => {
		if (isAtBottom) scrollToBottom("auto");
	}, [chat.messages, chat.running]);

	const submit = (text: string) => {
		setQuery("");
		chat.send(text).catch((err) => {
			setQuery(text);
			showErrorNotification(err);
		});
	};

	return (
		<div className="relative flex h-full w-full min-w-0 flex-col">
			<div className="absolute top-1.5 left-1 z-20">
				<ChatTitleEditor projectId={projectId} conversation={conversation} />
			</div>

			<div className="flex-1 overflow-y-auto px-4 pt-16 pb-8">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					{chat.isLoading && (
						<div className="flex animate-pulse flex-col gap-4 opacity-60">
							<div className="h-12 w-64 self-end rounded-2xl bg-surface-secondary" />
							<div className="h-20 w-full rounded-xl bg-surface-secondary" />
						</div>
					)}
					{chat.messages.map((m) => (
						<AgentMessage key={m.seq} message={m} waiting={chat.waiting} running={chat.running} />
					))}
					{chat.running && isThinking(chat.messages) && <Thinking since={chat.lastEventAt} />}
					{chat.error && <p className="text-sm text-danger">The run failed: {chat.error}</p>}
					{chat.stopReason && <LimitNotice reason={chat.stopReason} />}
					<div ref={bottomRef} className="h-0 w-0 shrink-0" />
				</div>
			</div>

			<div className="relative bg-background px-4 pt-2 pb-2">
				<ScrollToBottomButton isVisible={!isAtBottom} onClick={() => scrollToBottom("smooth")} />
				<div className="mx-auto w-full max-w-3xl">
					{conversation?.archived ? (
						<div className="w-full rounded-2xl border border-border bg-surface p-4 text-center text-sm text-muted">
							This conversation is archived and is read-only.
						</div>
					) : (
						<PromptEditor
							projectId={projectId}
							value={query}
							onChange={setQuery}
							onSubmit={submit}
							typewriter={false}
							placeholder={chat.waiting ? "Waiting for approval…" : "Reply to AI..."}
							isRunning={chat.running || chat.waiting}
							onStop={() => chat.stop().catch(showErrorNotification)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
