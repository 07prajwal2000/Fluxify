import { useState, type ReactNode } from "react";
import { TbLayoutSidebarLeftExpand } from "react-icons/tb";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@fluxify/components";
import { ConversationSidebar } from "./ConversationSidebar";

/**
 * Shell for the AI section: a persistent, slide-in conversation sidebar plus a
 * scrollable main area. Rendered by the `ai` layout route so the sidebar stays
 * mounted while the main content (new chat ↔ conversation) swaps.
 */
export function AiLayout({ children }: { children: ReactNode }) {
	const params = useParams({ strict: false }) as {
		projectId: string;
		conversationId?: string;
	};
	const navigate = useNavigate();
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const goToConversation = (conversationId: string) =>
		navigate({
			to: "/$projectId/ai/$conversationId",
			params: { projectId: params.projectId, conversationId },
			viewTransition: true,
		});

	const goToNew = () =>
		navigate({ to: "/$projectId/ai", params: { projectId: params.projectId }, viewTransition: true });

	return (
		<div className="relative flex h-full min-h-0">
			{/* Wrapper animates width; the panel keeps its fixed width so its
			    content doesn't reflow while sliding. */}
			<div
				className={`shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
					sidebarOpen ? "w-80 max-w-[85vw]" : "w-0"
				}`}
			>
				<ConversationSidebar
					projectId={params.projectId}
					activeId={params.conversationId}
					onToggle={() => setSidebarOpen(false)}
					onOpen={goToConversation}
					onNew={goToNew}
				/>
			</div>

			{!sidebarOpen && (
				<Button
					isIconOnly
					variant="secondary"
					className="absolute top-1 left-0 z-10"
					aria-label="Open conversations"
					onPress={() => setSidebarOpen(true)}
				>
					<TbLayoutSidebarLeftExpand size={18} />
				</Button>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
		</div>
	);
}
