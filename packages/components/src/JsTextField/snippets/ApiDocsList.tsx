import clsx from "clsx";
import { useMemo } from "react";
import { TbPlus } from "react-icons/tb";
import { type ApiDocItem, getGroupedApiDocs } from "./apiDocsData";
import type { CodeSnippet } from "./types";

export type ApiDocsListProps = {
	onInsert: (code: string) => void;
	onPreviewSnippet?: (snippet: CodeSnippet, target: HTMLElement) => void;
	onClosePreview?: () => void;
	searchQuery?: string;
	onClearSearch?: () => void;
	className?: string;
};

function matchesSearch(item: ApiDocItem, query: string): boolean {
	return (
		item.name.toLowerCase().includes(query) ||
		item.signature.toLowerCase().includes(query) ||
		item.description.toLowerCase().includes(query) ||
		item.kind.toLowerCase().includes(query) ||
		item.category.toLowerCase().includes(query)
	);
}

function ApiDocCard({
	item,
	onInsert,
	onPointerEnter,
	onPointerLeave,
}: {
	item: ApiDocItem;
	onInsert: (code: string) => void;
	onPointerEnter: (item: ApiDocItem, target: HTMLElement) => void;
	onPointerLeave?: () => void;
}) {
	const handleSelect = () => {
		onPointerLeave?.();
		onInsert(item.example || item.signature);
	};

	return (
		<div
			role="button"
			tabIndex={0}
			onPointerEnter={(e) => onPointerEnter(item, e.currentTarget)}
			onPointerLeave={onPointerLeave}
			onClick={handleSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleSelect();
				}
			}}
			className="group text-left w-full p-2.5 rounded-lg border border-border bg-surface hover:bg-surface-secondary hover:border-accent/50 cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-accent"
		>
			<div className="flex items-center justify-between gap-1 mb-1">
				<span className="text-xs font-mono font-medium text-foreground group-hover:text-accent transition-colors truncate">
					{item.name}
				</span>
				<div className="flex items-center gap-1.5 shrink-0">
					<span className="text-[9px] uppercase font-mono px-1 py-0.2 rounded bg-surface-secondary text-muted border border-border">
						{item.kind}
					</span>
					<TbPlus className="size-3.5 text-muted group-hover:text-accent shrink-0 transition-transform group-hover:scale-110" />
				</div>
			</div>

			<div className="text-[10px] font-mono text-accent/80 truncate mb-1 bg-surface-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
				{item.signature}
			</div>

			<p className="text-[11px] text-muted line-clamp-2 leading-relaxed">{item.description}</p>
		</div>
	);
}

export function ApiDocsList({
	onInsert,
	onPreviewSnippet,
	onClosePreview,
	searchQuery = "",
	onClearSearch,
	className,
}: ApiDocsListProps) {
	const allGroups = useMemo(() => getGroupedApiDocs(), []);

	const filteredGroups = useMemo(() => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return allGroups;
		return allGroups
			.map((group) => ({
				...group,
				items: group.items.filter((item) => matchesSearch(item, q)),
			}))
			.filter((group) => group.items.length > 0);
	}, [allGroups, searchQuery]);

	const handleItemPointerEnter = (item: ApiDocItem, element: HTMLElement) => {
		if (!onPreviewSnippet) return;
		const snippet: CodeSnippet = {
			id: item.id,
			title: item.name,
			description: item.description,
			category: item.category,
			code: item.example || item.signature,
			tags: [item.name, item.kind, item.category],
		};
		onPreviewSnippet(snippet, element);
	};

	return (
		<div
			className={clsx("flex-1 overflow-y-auto p-2.5 space-y-4", className)}
			onScroll={onClosePreview}
		>
			{filteredGroups.length === 0 ? (
				<div className="flex flex-col items-center justify-center h-36 text-center text-xs text-muted px-3">
					<p>No API references found.</p>
					{searchQuery && onClearSearch && (
						<button
							type="button"
							onClick={onClearSearch}
							className="mt-1 text-accent hover:underline cursor-pointer"
						>
							Clear search filter
						</button>
					)}
				</div>
			) : (
				filteredGroups.map((group) => (
					<div key={group.category} className="space-y-1.5">
						<div className="flex items-center justify-between px-1">
							<span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
								{group.title}
							</span>
							<span className="text-[10px] text-muted/70 font-mono">{group.items.length}</span>
						</div>

						<div className="space-y-1.5">
							{group.items.map((item) => (
								<ApiDocCard
									key={item.id}
									item={item}
									onInsert={onInsert}
									onPointerEnter={handleItemPointerEnter}
									onPointerLeave={onClosePreview}
								/>
							))}
						</div>
					</div>
				))
			)}
		</div>
	);
}
