import { useState, useEffect } from "react";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { HarnessConversation } from "./types";

export function ChatTitleEditor({
	projectId,
	conversation,
}: {
	projectId: string;
	conversation: HarnessConversation | null;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [title, setTitle] = useState("");
	const updateMutation = harnessConversationsQuery.update.mutation(
		projectId,
		conversation?.id || "",
	);

	useEffect(() => {
		if (!isEditing && conversation) {
			setTitle(conversation.title ?? "Untitled session");
		}
	}, [conversation, isEditing]);

	if (!conversation) return null;

	const handleSave = () => {
		setIsEditing(false);
		const trimmed = title.trim();
		if (trimmed && trimmed !== conversation.title) {
			updateMutation.mutate(
				{ title: trimmed },
				{
					onError: (err) => {
						showErrorNotification(err);
						setTitle(conversation.title ?? "Untitled session");
					},
				},
			);
		} else {
			setTitle(conversation.title ?? "Untitled session");
		}
	};

	return isEditing ? (
		<input
			autoFocus
			className="h-8 w-80 rounded-md border border-border bg-surface px-2 text-sm font-medium text-foreground outline-none"
			value={title}
			onChange={(e) => setTitle(e.target.value)}
			onBlur={handleSave}
			onKeyDown={(e) => {
				if (e.key === "Enter") handleSave();
				if (e.key === "Escape") {
					setIsEditing(false);
					setTitle(conversation.title ?? "Untitled session");
				}
			}}
		/>
	) : (
		<button
			type="button"
			onClick={() => setIsEditing(true)}
			className="max-w-[400px] truncate rounded-md border border-border bg-surface/50 px-2 py-1 text-left text-sm font-semibold text-foreground/90 transition-colors hover:bg-surface"
			aria-label="Edit chat title"
		>
			{title || "Untitled session"}
		</button>
	);
}
