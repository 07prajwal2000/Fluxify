import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import type { ReviewKind } from "@/services/agentReviews";

/** The small agent chat the canvas's AI button opens (#754). */
export type CanvasChat = {
	isOpen: boolean;
	/** the chat shown; none until the first message of a new one is sent */
	conversationId?: string;
	/** text a new chat's prompt starts with */
	draft: string;
	/** bumped by every open(), so the new chat's prompt starts over */
	draftSeq: number;
	/** a new chat, its prompt holding `draft` when given */
	open: (draft?: string) => void;
	/** opens the chat on an existing conversation */
	show: (conversationId: string) => void;
	toggle: () => void;
	close: () => void;
	setConversation: (id: string) => void;
};

export type CanvasAi = {
	projectId: string;
	/** what an AI review reads; only routes and workflows have one */
	review?: { kind: ReviewKind; id: string };
	chat: CanvasChat;
};

const CanvasAiContext = createContext<CanvasAi | undefined>(undefined);

/** Undefined on a canvas no page wired the AI into (an embed, a preview). */
export const useCanvasAi = () => useContext(CanvasAiContext);

/**
 * Cuts a canvas drawn inside another (the chat's diff preview) off from the
 * page's AI: otherwise it renders the chat again, whose preview renders
 * another canvas, without end.
 */
export const WithoutCanvasAi = ({ children }: { children: ReactNode }) => (
	<CanvasAiContext.Provider value={undefined}>{children}</CanvasAiContext.Provider>
);

export function CanvasAiProvider({
	projectId,
	review,
	children,
}: {
	projectId: string;
	review?: CanvasAi["review"];
	children: ReactNode;
}) {
	const [isOpen, setOpen] = useState(false);
	const [conversationId, setConversation] = useState<string>();
	const [draft, setDraft] = useState({ text: "", seq: 0 });
	const kind = review?.kind;
	const id = review?.id;
	const value = useMemo<CanvasAi>(
		() => ({
			projectId,
			review: kind && id ? { kind, id } : undefined,
			chat: {
				isOpen,
				conversationId,
				draft: draft.text,
				draftSeq: draft.seq,
				open: (text = "") => {
					setConversation(undefined);
					setDraft((d) => ({ text, seq: d.seq + 1 }));
					setOpen(true);
				},
				show: (id) => {
					setConversation(id);
					setOpen(true);
				},
				toggle: () => setOpen((o) => !o),
				close: () => setOpen(false),
				setConversation,
			},
		}),
		[projectId, kind, id, isOpen, conversationId, draft],
	);
	return <CanvasAiContext.Provider value={value}>{children}</CanvasAiContext.Provider>;
}
