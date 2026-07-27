import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { PromptEditor } from "./PromptEditor";
import { useAiModels } from "./useAiModels";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useIsRunning } from "@/store/aiHarness";
import { MarkdownViewer } from "./MarkdownViewer";

export function ConversationPage() {
	const { projectId, conversationId } = useParams({
		from: "/_authed/$projectId/ai/$conversationId",
	});
	const [query, setQuery] = useState("");

	const { models, defaultModelId } = useAiModels(projectId);
	const sendMessage = harnessConversationsQuery.sendMessage.mutation(projectId);
	const actionMutation = harnessConversationsQuery.action.mutation(
		projectId,
		conversationId,
	);

	const isRunning = useIsRunning(conversationId);
	const { data: messagesData } =
		harnessConversationsQuery.messages.useInfiniteQuery(
			projectId,
			conversationId,
		);

	// API returns oldest first in each page, but infinite query appends older pages to the end.
	// We want to render them so newest is at the bottom.
	const messages = messagesData?.pages.flatMap((p) => p.messages) ?? [];

	const submit = (q: string, model: string, isFallback: boolean) => {
		const reqPayload: {
			query: string;
			integrationId?: string;
			conversationId: string;
		} = {
			query: q,
			conversationId,
		};
		if (!isFallback && model) {
			reqPayload.integrationId = model;
		}

		sendMessage.mutate(reqPayload, {
			onSuccess: () => setQuery(""),
			onError: (err) => showErrorNotification(err),
		});
	};

	const stop = () => {
		actionMutation.mutate(
			{ action: "user_interrupt" },
			{ onError: (err) => showErrorNotification(err) },
		);
	};

	return (
		<div className="flex h-full flex-col relative">
			<div className="flex-1 overflow-y-auto px-4 py-12">
				<div className="mx-auto flex w-full max-w-3xl flex-col-reverse gap-6">
					{messages.length === 0 ? (
						<div className="text-center">
							<p className="text-sm text-muted">Conversation</p>
							<p className="font-mono text-xs text-muted">{conversationId}</p>
						</div>
					) : (
						messages.map((msg) => (
							<div key={msg.id} className="flex w-full flex-col gap-4">
								{msg.userQuery && (
									<div className="flex w-full justify-end">
										<div className="max-w-[85%] rounded-2xl bg-content2 px-5 py-3 text-sm text-foreground shadow-sm">
											{msg.userQuery}
										</div>
									</div>
								)}
								{msg.aiResponse && (
									<div className="w-full">
										<MarkdownViewer content={msg.aiResponse} />
									</div>
								)}
							</div>
						))
					)}
				</div>
			</div>

			<div className="sticky bottom-0 p-4 bg-background">
				<div className="mx-auto w-full max-w-3xl">
					<PromptEditor
						projectId={projectId}
						value={query}
						onChange={setQuery}
						onSubmit={submit}
						isPending={sendMessage.isPending}
						models={models}
						defaultModelId={defaultModelId}
						typewriter={false}
						placeholder="Reply to AI..."
						isRunning={isRunning}
						onStop={stop}
					/>
				</div>
			</div>
		</div>
	);
}
