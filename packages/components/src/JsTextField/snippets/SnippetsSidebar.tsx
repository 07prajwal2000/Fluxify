import { Button, Tabs } from "@heroui/react";
import clsx from "clsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TbPlus, TbSearch, TbX } from "react-icons/tb";
import { EditorSettingsMenu, type EditorTheme } from "../EditorSettingsMenu";
import { ApiDocsList } from "./ApiDocsList";
import { SnippetPreviewPanel } from "./SnippetPreviewPanel";
import type { CodeSnippet } from "./types";

const HOVER_ENTER_DELAY_MS = 250;
const HOVER_LEAVE_DELAY_MS = 200;

export type SnippetsSidebarProps = {
	snippets: CodeSnippet[];
	onInsert: (code: string) => void;
	onSave: () => void;
	theme: EditorTheme;
	onThemeChange: (theme: EditorTheme) => void;
	wordWrap: boolean;
	onWordWrapChange: (wordWrap: boolean) => void;
	className?: string;
};

export function SnippetsSidebar({
	snippets,
	onInsert,
	onSave,
	theme,
	onThemeChange,
	wordWrap,
	onWordWrapChange,
	className,
}: SnippetsSidebarProps) {
	const searchInputId = useId();
	const [activeTab, setActiveTab] = useState<"snippets" | "api">("snippets");
	const [isSearchExpanded, setIsSearchExpanded] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const sidebarRef = useRef<HTMLDivElement>(null);

	// Snippet hover preview state
	const [activeSnippet, setActiveSnippet] = useState<CodeSnippet | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const activeSnippetRef = useRef<CodeSnippet | null>(null);
	const activeCardRef = useRef<HTMLElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const enterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	activeSnippetRef.current = activeSnippet;
	activeCardRef.current = anchorEl;

	const closePreview = () => {
		if (enterTimeoutRef.current) clearTimeout(enterTimeoutRef.current);
		if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
		enterTimeoutRef.current = null;
		leaveTimeoutRef.current = null;
		setActiveSnippet(null);
		setAnchorEl(null);
	};

	useEffect(() => {
		return () => {
			if (enterTimeoutRef.current) clearTimeout(enterTimeoutRef.current);
			if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
		};
	}, []);

	useEffect(() => {
		if (!activeSnippet) return;

		const handlePointerMove = (e: PointerEvent) => {
			const cardEl = activeCardRef.current;
			const panelEl = panelRef.current;
			if (!cardEl) return;

			const cardRect = cardEl.getBoundingClientRect();
			const panelRect = panelEl?.getBoundingClientRect();

			const x = e.clientX;
			const y = e.clientY;

			const inCard =
				x >= cardRect.left && x <= cardRect.right && y >= cardRect.top && y <= cardRect.bottom;

			const inPanel = panelRect
				? x >= panelRect.left - 6 &&
					x <= panelRect.right + 6 &&
					y >= panelRect.top - 6 &&
					y <= panelRect.bottom + 6
				: false;

			let inCorridor = false;
			if (panelRect) {
				const minX = Math.min(cardRect.left, panelRect.left);
				const maxX = Math.max(cardRect.right, panelRect.right);
				const minY = Math.min(cardRect.top, panelRect.top) - 12;
				const maxY = Math.max(cardRect.bottom, panelRect.bottom) + 12;
				inCorridor = x >= minX && x <= maxX && y >= minY && y <= maxY;
			}

			if (inCard || inPanel || inCorridor) {
				if (leaveTimeoutRef.current) {
					clearTimeout(leaveTimeoutRef.current);
					leaveTimeoutRef.current = null;
				}
			} else {
				if (!leaveTimeoutRef.current) {
					leaveTimeoutRef.current = setTimeout(() => {
						closePreview();
					}, 300);
				}
			}
		};

		window.addEventListener("pointermove", handlePointerMove, { capture: true });
		return () => {
			window.removeEventListener("pointermove", handlePointerMove, { capture: true });
		};
	}, [activeSnippet]);

	const handleCardPointerEnter = (snippet: CodeSnippet, target: HTMLElement) => {
		if (activeSnippetRef.current?.id === snippet.id) {
			if (leaveTimeoutRef.current) {
				clearTimeout(leaveTimeoutRef.current);
				leaveTimeoutRef.current = null;
			}
			return;
		}

		if (enterTimeoutRef.current) {
			clearTimeout(enterTimeoutRef.current);
		}

		enterTimeoutRef.current = setTimeout(() => {
			if (leaveTimeoutRef.current) {
				clearTimeout(leaveTimeoutRef.current);
				leaveTimeoutRef.current = null;
			}
			setActiveSnippet(snippet);
			setAnchorEl(target);
		}, 200);
	};

	const handleCardPointerLeave = (snippet: CodeSnippet) => {
		if (enterTimeoutRef.current && activeSnippetRef.current?.id !== snippet.id) {
			clearTimeout(enterTimeoutRef.current);
			enterTimeoutRef.current = null;
		}
	};

	const filteredSnippets = useMemo(() => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return snippets;
		return snippets.filter((s) => {
			const inTitle = s.title.toLowerCase().includes(q);
			const inDesc = s.description.toLowerCase().includes(q);
			const inTags = s.tags?.some((t) => t.toLowerCase().includes(q));
			const inCode = s.code.toLowerCase().includes(q);
			return inTitle || inDesc || inTags || inCode;
		});
	}, [snippets, searchQuery]);

	const handleOpenSearch = () => {
		setIsSearchExpanded(true);
		setTimeout(() => {
			searchInputRef.current?.focus();
		}, 50);
	};

	const handleBlurSearch = () => {
		if (!searchQuery.trim()) {
			setIsSearchExpanded(false);
		}
	};

	const handleClearSearch = () => {
		setSearchQuery("");
		setIsSearchExpanded(false);
	};

	return (
		<div
			ref={sidebarRef}
			className={clsx(
				"flex flex-col h-full border-l border-border bg-surface/30 relative z-20",
				className,
			)}
		>
			{/* Top Bar: HeroUI secondary Tabs + Expandable Search */}
			<div className="flex items-center justify-between p-2.5 border-b border-border min-h-12 relative overflow-hidden">
				{!isSearchExpanded && (
					<Tabs
						variant="secondary"
						selectedKey={activeTab}
						onSelectionChange={(k) => {
							closePreview();
							setActiveTab(k as "snippets" | "api");
						}}
					>
						<Tabs.ListContainer>
							<Tabs.List aria-label="Editor reference tabs">
								<Tabs.Tab id="snippets">
									Snippets
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="api">
									API
									<Tabs.Indicator />
								</Tabs.Tab>
							</Tabs.List>
						</Tabs.ListContainer>
					</Tabs>
				)}

				{isSearchExpanded ? (
					<div className="flex items-center gap-1.5 w-full bg-surface-secondary border border-border rounded-lg px-2.5 py-1 transition-all duration-200">
						<TbSearch className="size-3.5 text-muted shrink-0" />
						<input
							ref={searchInputRef}
							id={searchInputId}
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onBlur={handleBlurSearch}
							onKeyDown={(e) => {
								if (e.key === "Escape") handleClearSearch();
							}}
							placeholder={
								activeTab === "snippets" ? "Search snippets..." : "Search API reference..."
							}
							className="bg-transparent text-xs text-foreground placeholder:text-muted outline-none w-full min-w-0"
						/>
						{searchQuery && (
							<button
								type="button"
								onMouseDown={(e) => {
									e.preventDefault();
									handleClearSearch();
								}}
								className="text-muted hover:text-foreground shrink-0 cursor-pointer"
								aria-label="Clear search"
							>
								<TbX className="size-3" />
							</button>
						)}
					</div>
				) : (
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-2 text-xs text-muted hover:text-foreground gap-1.5 rounded-md shrink-0"
						onPress={handleOpenSearch}
						aria-label={activeTab === "snippets" ? "Search snippets" : "Search API reference"}
					>
						<TbSearch className="size-3.5" />
						<span>Search</span>
					</Button>
				)}
			</div>

			{/* Content: Snippets List or API Docs */}
			{activeTab === "snippets" ? (
				<div className="flex-1 overflow-y-auto p-2.5 space-y-2" onScroll={closePreview}>
					{filteredSnippets.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-36 text-center text-xs text-muted px-3">
							<p>No snippets found.</p>
							{searchQuery && (
								<button
									type="button"
									onClick={handleClearSearch}
									className="mt-1 text-accent hover:underline cursor-pointer"
								>
									Clear search filter
								</button>
							)}
						</div>
					) : (
						filteredSnippets.map((snippet) => (
							<div
								key={snippet.id}
								role="button"
								tabIndex={0}
								onPointerEnter={(e) => handleCardPointerEnter(snippet, e.currentTarget)}
								onPointerLeave={() => handleCardPointerLeave(snippet)}
								onClick={() => {
									closePreview();
									onInsert(snippet.code);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										closePreview();
										onInsert(snippet.code);
									}
								}}
								className="group text-left w-full p-2.5 rounded-lg border border-border bg-surface hover:bg-surface-secondary hover:border-accent/50 cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-accent"
							>
								<div className="flex items-center justify-between gap-1 mb-1">
									<span className="text-xs font-medium text-foreground group-hover:text-accent transition-colors truncate">
										{snippet.title}
									</span>
									<TbPlus className="size-3.5 text-muted group-hover:text-accent shrink-0 transition-transform group-hover:scale-110" />
								</div>
								<p className="text-[11px] text-muted line-clamp-2 leading-relaxed">
									{snippet.description}
								</p>
							</div>
						))
					)}
				</div>
			) : (
				<ApiDocsList
					onInsert={onInsert}
					onPreviewSnippet={handleCardPointerEnter}
					onClosePreview={closePreview}
					searchQuery={searchQuery}
					onClearSearch={handleClearSearch}
				/>
			)}

			{/* Stable Preview Panel */}
			<SnippetPreviewPanel
				anchorEl={anchorEl}
				sidebarEl={sidebarRef.current}
				isOpen={Boolean(activeSnippet && anchorEl && sidebarRef.current)}
				onClose={closePreview}
				onInsert={(code) => {
					closePreview();
					onInsert(code);
				}}
				panelRef={panelRef}
				snippet={activeSnippet}
				theme={theme}
				wordWrap={wordWrap}
			/>

			{/* Footer: Settings & Save Buttons */}
			<div className="p-3 border-t border-border flex items-center justify-between">
				<EditorSettingsMenu
					onThemeChange={onThemeChange}
					onWordWrapChange={onWordWrapChange}
					theme={theme}
					wordWrap={wordWrap}
				/>
				<Button
					size="sm"
					variant="primary"
					className="h-8 px-4 text-xs font-medium"
					onPress={onSave}
				>
					Save
				</Button>
			</div>
		</div>
	);
}
