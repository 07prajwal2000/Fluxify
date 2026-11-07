import { useEffect, useRef } from "react";
import { useCanvasAi } from "./CanvasAiContext";

/**
 * One side panel at a time (#754): the AI chat closes Diagnostics and the block
 * settings when it opens, and either of them closes the chat. Diagnostics and
 * the settings already close each other (`useCanvasDiagnosticsBridge`).
 */
export function useExclusiveChatPanel(
	diagnostics: { isPanelOpen: boolean; closePanel: () => void },
	panel: { openBlockId: string | null; close: () => void },
) {
	const chat = useCanvasAi()?.chat;
	const chatOpen = !!chat?.isOpen;
	const otherOpen = diagnostics.isPanelOpen || !!panel.openBlockId;
	const before = useRef({ chatOpen, otherOpen });
	const { closePanel } = diagnostics;
	const closeBlock = panel.close;
	const closeChat = chat?.close;
	useEffect(() => {
		const was = before.current;
		before.current = { chatOpen, otherOpen };
		if (chatOpen && !was.chatOpen) {
			closePanel();
			closeBlock();
		} else if (otherOpen && !was.otherOpen && chatOpen) closeChat?.();
	}, [chatOpen, otherOpen, closePanel, closeBlock, closeChat]);
}
