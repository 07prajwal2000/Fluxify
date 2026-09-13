import { Button } from "@heroui/react";
import { TbPlus } from "react-icons/tb";
import { JavaScriptTextArea } from "../../JavaScriptTextArea";
import type { EditorTheme } from "../EditorSettingsMenu";
import type { CodeSnippet } from "./types";

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 280;

export type SnippetPreviewPanelProps = {
	snippet: CodeSnippet | null;
	anchorEl: HTMLElement | null;
	sidebarEl: HTMLElement | null;
	isOpen: boolean;
	onClose: () => void;
	onInsert: (code: string) => void;
	theme: EditorTheme;
	wordWrap?: boolean;
	panelRef?: React.RefObject<HTMLDivElement | null>;
};

function computeTop(
	anchorEl: HTMLElement | null,
	sidebarEl: HTMLElement | null,
): number {
	if (!anchorEl || !sidebarEl) return 8;
	const cardRect = anchorEl.getBoundingClientRect();
	const sidebarRect = sidebarEl.getBoundingClientRect();

	const top = cardRect.top - sidebarRect.top;
	const maxTop = Math.max(8, sidebarRect.height - PANEL_HEIGHT - 8);
	return Math.max(8, Math.min(top, maxTop));
}

export function SnippetPreviewPanel({
	snippet,
	anchorEl,
	sidebarEl,
	isOpen,
	onClose,
	onInsert,
	theme,
	wordWrap = false,
	panelRef,
}: SnippetPreviewPanelProps) {
	if (!isOpen || !snippet || !anchorEl || !sidebarEl) {
		return null;
	}

	const top = computeTop(anchorEl, sidebarEl);

	return (
		<div
			ref={panelRef}
			role="tooltip"
			aria-label={`${snippet.title} preview`}
			style={{
				position: "absolute",
				top: `${top}px`,
				right: "calc(100% + 8px)",
				width: `${PANEL_WIDTH}px`,
				maxWidth: "calc(100vw - 360px)",
				height: `${PANEL_HEIGHT}px`,
				zIndex: 50,
			}}
			className="rounded-xl border border-border bg-overlay shadow-2xl overflow-hidden flex flex-col pointer-events-auto animate-in fade-in zoom-in-95 duration-100"
		>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface/90 shrink-0">
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-xs font-semibold text-foreground truncate">
						{snippet.title}
					</span>
					<span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-surface-secondary text-muted border border-border shrink-0">
						{snippet.category}
					</span>
				</div>
				<Button
					size="sm"
					variant="primary"
					className="h-6 px-2.5 text-[11px] font-medium gap-1 shrink-0 cursor-pointer"
					onPress={() => {
						onInsert(snippet.code);
						onClose();
					}}
					onClick={(e) => {
						e.stopPropagation();
						onInsert(snippet.code);
						onClose();
					}}
				>
					<TbPlus className="size-3" />
					<span>Insert</span>
				</Button>
			</div>

			{/* Description */}
			<div className="px-3 py-1 bg-surface-secondary/40 border-b border-border text-[11px] text-muted shrink-0 truncate">
				{snippet.description}
			</div>

			{/* Monaco Code Preview */}
			<div className="flex-1 min-h-0 w-full overflow-hidden bg-background">
				<JavaScriptTextArea
					aria-label={`${snippet.title} code preview`}
					className="h-full border-none rounded-none"
					height="100%"
					readOnly
					showLineNumbers
					theme={theme === "auto" ? undefined : theme}
					value={snippet.code}
					wordWrap={wordWrap}
				/>
			</div>
		</div>
	);
}
