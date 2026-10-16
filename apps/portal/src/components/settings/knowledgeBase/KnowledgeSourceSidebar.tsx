import { Autocomplete, cn, Input, ListBox, SearchField, useFilter } from "@fluxify/components";
import { useMemo, useState } from "react";
import {
	TbAlertTriangle,
	TbCheck,
	TbChevronDown,
	TbChevronRight,
	TbFileText,
	TbFilter,
	TbLink,
	TbListCheck,
	TbSearch,
	TbWorld,
} from "react-icons/tb";
import type { KnowledgeSourceSummary, KnowledgeSourceType } from "@/services/knowledgeSources";

const TYPE_ICONS: Record<
	KnowledgeSourceType,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	markdown: TbFileText,
	url: TbLink,
	llms_txt: TbListCheck,
	llms_full_txt: TbWorld,
};

const FILTER_OPTIONS: Array<{ value: "all" | KnowledgeSourceType; label: string }> = [
	{ value: "all", label: "All types" },
	{ value: "markdown", label: "Markdown" },
	{ value: "url", label: "Single URL" },
	{ value: "llms_txt", label: "llms.txt" },
	{ value: "llms_full_txt", label: "llms-full.txt" },
];

interface KnowledgeSourceSidebarProps {
	sources: KnowledgeSourceSummary[];
	selectedSourceId: string | null;
	isAdding: boolean;
	canEdit: boolean;
	onSelectSource: (id: string) => void;
	onAddSource: () => void;
}

export function KnowledgeSourceSidebar({
	sources,
	selectedSourceId,
	isAdding,
	canEdit,
	onSelectSource,
	onAddSource,
}: KnowledgeSourceSidebarProps) {
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState<"all" | KnowledgeSourceType>("all");
	const [expandedLlmsSources, setExpandedLlmsSources] = useState<Record<string, boolean>>({});

	function toggleLlmsExpand(id: string, e: React.MouseEvent) {
		e.stopPropagation();
		setExpandedLlmsSources((prev) => ({
			...prev,
			[id]: !prev[id],
		}));
	}

	const filteredSources = useMemo(() => {
		const q = search.trim().toLowerCase();
		return sources.filter((src) => {
			if (typeFilter !== "all" && src.type !== typeFilter) return false;
			if (q && !src.name.toLowerCase().includes(q) && !src.url?.toLowerCase().includes(q)) {
				return false;
			}
			return true;
		});
	}, [sources, search, typeFilter]);

	const countsByType = useMemo(() => {
		const counts: Record<string, number> = { all: sources.length };
		for (const s of sources) {
			counts[s.type] = (counts[s.type] ?? 0) + 1;
		}
		return counts;
	}, [sources]);

	const { contains } = useFilter({ sensitivity: "base" });

	return (
		<div className="flex h-full min-h-0 w-full flex-col border-r border-border bg-surface-secondary/20">
			{/* Top bar with Search & Filter */}
			<div className="p-3 border-b border-border">
				<div className="flex items-center gap-2">
					<div className="relative flex-1 min-w-0">
						<Input
							placeholder="Search sources..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="text-xs pl-7 h-8 w-full"
						/>
						<TbSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" size={13} />
					</div>

					<div className="w-32 shrink-0">
						<Autocomplete
							variant="secondary"
							value={typeFilter}
							onChange={(next) =>
								next != null && setTypeFilter(String(next) as "all" | KnowledgeSourceType)
							}
							aria-label="Filter by type"
						>
							<Autocomplete.Trigger className="h-8 px-2.5 text-xs flex items-center justify-between">
								<div className="flex items-center gap-1.5 min-w-0">
									<TbFilter size={12} className="text-muted shrink-0" />
									<span className="truncate">
										{FILTER_OPTIONS.find((o) => o.value === typeFilter)?.label ?? "All"}
									</span>
								</div>
								<Autocomplete.Indicator />
							</Autocomplete.Trigger>
							<Autocomplete.Popover className="w-64">
								<Autocomplete.Filter filter={contains}>
									<SearchField autoFocus aria-label="Search types" variant="secondary">
										<SearchField.Group>
											<SearchField.SearchIcon />
											<SearchField.Input placeholder="Filter types..." />
										</SearchField.Group>
									</SearchField>
									<ListBox>
										{FILTER_OPTIONS.map((opt) => (
											<ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
												<div className="flex items-center justify-between w-full text-xs py-0.5">
													<span className="font-medium text-foreground whitespace-nowrap">
														{opt.label}
													</span>
													<span className="text-[11px] text-muted ml-3 shrink-0">
														({countsByType[opt.value] ?? 0})
													</span>
												</div>
												<ListBox.ItemIndicator />
											</ListBox.Item>
										))}
									</ListBox>
								</Autocomplete.Filter>
							</Autocomplete.Popover>
						</Autocomplete>
					</div>
				</div>
			</div>

			{/* Source list */}
			<div className="flex-1 min-h-0 overflow-y-auto p-2">
				{filteredSources.length === 0 ? (
					<div className="p-4 text-center text-xs text-muted">
						{sources.length === 0 ? (
							<>
								No knowledge sources yet.
								{canEdit && <p className="mt-1">Click "Add source" above to get started.</p>}
							</>
						) : (
							"No sources match your search or filter."
						)}
					</div>
				) : (
					<div className="flex flex-col gap-0.5">
						{filteredSources.map((src) => {
							const isSelected = !isAdding && selectedSourceId === src.id;
							const isLlms = src.type === "llms_txt";
							const isExpanded = Boolean(expandedLlmsSources[src.id]);
							const Icon = TYPE_ICONS[src.type];

							return (
								<div key={src.id} className="flex flex-col">
									<div
										className={cn(
											"flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
											isSelected
												? "bg-accent/10 text-accent font-medium"
												: "text-foreground hover:bg-surface-secondary",
										)}
									>
										<div className="flex items-center gap-2 min-w-0 flex-1">
											{/* Type icon */}
											<Icon
												size={15}
												className={cn("shrink-0", isSelected ? "text-accent" : "text-muted")}
											/>

											{/* Expand chevron for llms_txt */}
											{isLlms && (
												<button
													type="button"
													onClick={(e) => toggleLlmsExpand(src.id, e)}
													className="p-0.5 text-muted hover:text-foreground rounded shrink-0"
													aria-label={isExpanded ? "Collapse pages" : "Expand pages"}
												>
													{isExpanded ? <TbChevronDown size={12} /> : <TbChevronRight size={12} />}
												</button>
											)}

											{/* Select button */}
											<button
												type="button"
												onClick={() => onSelectSource(src.id)}
												className="flex items-center gap-1.5 min-w-0 flex-1 text-left py-0.5"
											>
												{/* Enabled dot */}
												<span
													title={src.enabled ? "Enabled" : "Disabled"}
													className={cn(
														"h-1.5 w-1.5 rounded-full shrink-0",
														src.enabled ? "bg-success" : "bg-muted/40",
													)}
												/>
												<span className="truncate font-mono text-[11px]">{src.name}</span>
											</button>
										</div>

										{/* Status icon */}
										<div className="flex items-center gap-1 shrink-0 ml-1">
											{Boolean(src.editedCount && src.editedCount > 0) && (
												<span
													title={`${src.editedCount} page${src.editedCount === 1 ? "" : "s"} edited`}
													className="rounded bg-amber-500/10 px-1 py-0.2 text-[9px] font-medium text-amber-500 font-mono"
												>
													edited
												</span>
											)}
											{src.lastFetchStatus === "ok" && (
												<span title="Fetched successfully">
													<TbCheck size={12} className="text-success" />
												</span>
											)}
											{src.lastFetchStatus === "error" && (
												<span title={src.lastFetchError || "Fetch failed"} className="text-danger">
													<TbAlertTriangle size={12} />
												</span>
											)}
										</div>
									</div>

									{/* llms_txt expanded pages */}
									{isLlms && isExpanded && (
										<div className="ml-6 flex flex-col gap-0.5 border-l border-border/60 pl-2 my-0.5">
											{src.selectedPages.length === 0 ? (
												<span className="text-[10px] text-muted italic">No indexed pages</span>
											) : (
												src.selectedPages.map((pageUrl) => (
													<div
														key={pageUrl}
														title={pageUrl}
														className="truncate text-[10px] text-muted py-0.5 font-mono"
													>
														{pageUrl.split("/").pop() || pageUrl}
													</div>
												))
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
