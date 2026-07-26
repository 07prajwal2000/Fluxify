import { useParams } from "@tanstack/react-router";

/** Conversation view — empty shell for now; the live run UI lands next. */
export function ConversationPage() {
	const { conversationId } = useParams({ from: "/_authed/$projectId/ai/$conversationId" });

	return (
		<div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-2 px-4 py-12 text-center">
			<p className="text-sm text-muted">Conversation</p>
			<p className="font-mono text-xs text-muted">{conversationId}</p>
		</div>
	);
}
