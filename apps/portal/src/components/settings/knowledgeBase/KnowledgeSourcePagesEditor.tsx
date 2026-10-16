import {
	Alert,
	Autocomplete,
	Button,
	Chip,
	Label,
	ListBox,
	SearchField,
	toast,
	useFilter,
} from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbAlertCircle, TbPencil } from "react-icons/tb";
import { DocsEditor } from "@/components/customBlocks/DocsEditor";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { knowledgeSourcesQuery } from "@/query/knowledgeSourcesQuery";
import type { KnowledgeSourceDetail } from "@/services/knowledgeSources";

interface KnowledgeSourcePagesEditorProps {
	projectId: string;
	source: KnowledgeSourceDetail;
	canEdit: boolean;
}

export function KnowledgeSourcePagesEditor({
	projectId,
	source,
	canEdit,
}: KnowledgeSourcePagesEditorProps) {
	const updatePageMutation = knowledgeSourcesQuery.updatePage.mutation(projectId);

	const [activePageIndex, setActivePageIndex] = useState(0);
	const [isEditingPage, setIsEditingPage] = useState(false);
	const [pageDraftMarkdown, setPageDraftMarkdown] = useState("");
	const [pageEditorMode, setPageEditorMode] = useState<"write" | "preview">("preview");
	const [pageError, setPageError] = useState<string | null>(null);

	const { contains } = useFilter({ sensitivity: "base" });

	useEffect(() => {
		if (!isEditingPage) {
			setPageDraftMarkdown(source.pages[activePageIndex]?.markdown ?? "");
		}
	}, [source, activePageIndex, isEditingPage]);

	function handleSelectPage(index: number) {
		setActivePageIndex(index);
		setIsEditingPage(false);
		setPageEditorMode("preview");
		setPageError(null);
		const targetPage = source.pages[index];
		if (targetPage) {
			setPageDraftMarkdown(targetPage.markdown);
		}
	}

	function handleStartEditPage() {
		setPageError(null);
		setPageDraftMarkdown(source.pages[activePageIndex]?.markdown ?? "");
		setIsEditingPage(true);
		setPageEditorMode("write");
	}

	function handleCancelEditPage() {
		setPageError(null);
		setPageDraftMarkdown(source.pages[activePageIndex]?.markdown ?? "");
		setIsEditingPage(false);
		setPageEditorMode("preview");
	}

	async function handleSavePage() {
		setPageError(null);
		try {
			await updatePageMutation.mutateAsync({
				id: source.id,
				index: activePageIndex,
				body: { markdown: pageDraftMarkdown },
			});
			setIsEditingPage(false);
			setPageEditorMode("preview");
			toast.success("Page markdown saved");
		} catch (err) {
			const parsed = parseApiError(err);
			setPageError(parsed.message);
			showErrorNotification(err);
		}
	}

	const activePage = source.pages[activePageIndex];

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Label className="text-xs font-semibold uppercase tracking-wider text-muted">
						Indexed Content Preview
					</Label>
					{Boolean(activePage?.edited) && (
						<Chip
							size="sm"
							variant="soft"
							className="text-[11px] h-5 bg-amber-500/10 text-amber-500 border border-amber-500/20"
						>
							edited
						</Chip>
					)}
				</div>

				<div className="flex items-center gap-3">
					{source.pages.length > 1 && (
						<div className="flex items-center gap-2 min-w-[200px] max-w-xs">
							<span className="text-xs font-medium text-muted shrink-0">Page:</span>
							<div className="flex-1 min-w-0">
								<Autocomplete
									variant="secondary"
									value={String(activePageIndex)}
									onChange={(next) => next != null && handleSelectPage(Number(next))}
									aria-label="Select preview page"
								>
									<Autocomplete.Trigger className="h-7 text-xs">
										<Autocomplete.Value>
											{activePage?.url
												? activePage.url.split("/").pop() || activePage.url
												: `Page ${activePageIndex + 1}`}
										</Autocomplete.Value>
										<Autocomplete.Indicator />
									</Autocomplete.Trigger>
									<Autocomplete.Popover className="w-80">
										<Autocomplete.Filter filter={contains}>
											<SearchField autoFocus aria-label="Search pages" variant="secondary">
												<SearchField.Group>
													<SearchField.SearchIcon />
													<SearchField.Input placeholder="Search page..." />
												</SearchField.Group>
											</SearchField>
											<ListBox className="max-h-60 overflow-y-auto">
												{source.pages.map((p, idx) => {
													const displayTitle = p.url
														? p.url.split("/").pop() || p.url
														: `Page ${idx + 1}`;
													return (
														<ListBox.Item
															key={p.url || idx}
															id={String(idx)}
															textValue={p.url || `Page ${idx + 1}`}
														>
															<div className="flex items-center justify-between gap-2 w-full text-xs min-w-0">
																<div className="flex flex-col min-w-0 flex-1">
																	<span className="font-medium text-foreground truncate">
																		{displayTitle}
																	</span>
																	{p.url && displayTitle !== p.url && (
																		<span className="text-[10px] text-muted truncate">{p.url}</span>
																	)}
																</div>
																{p.edited && (
																	<span className="rounded bg-amber-500/10 px-1 py-0.2 text-[9px] font-medium text-amber-500 font-mono shrink-0">
																		edited
																	</span>
																)}
															</div>
															<ListBox.ItemIndicator />
														</ListBox.Item>
													);
												})}
											</ListBox>
										</Autocomplete.Filter>
									</Autocomplete.Popover>
								</Autocomplete>
							</div>
						</div>
					)}

					{canEdit && source.pages.length > 0 && (
						<div className="flex items-center gap-1.5 shrink-0">
							{!isEditingPage ? (
								<Button size="sm" variant="outline" onPress={handleStartEditPage}>
									<TbPencil size={14} className="mr-1" /> Edit page
								</Button>
							) : (
								<>
									<Button
										size="sm"
										variant="primary"
										isPending={updatePageMutation.isPending}
										onPress={handleSavePage}
									>
										Save
									</Button>
									<Button
										size="sm"
										variant="ghost"
										isDisabled={updatePageMutation.isPending}
										onPress={handleCancelEditPage}
									>
										Cancel
									</Button>
								</>
							)}
						</div>
					)}
				</div>
			</div>

			{pageError && (
				<Alert status="danger">
					<Alert.Indicator>
						<TbAlertCircle size={16} />
					</Alert.Indicator>
					<Alert.Content>
						<Alert.Description>{pageError}</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<div className="flex min-h-[300px] flex-1 flex-col">
				{source.pages.length === 0 ? (
					<div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-border bg-surface p-4 text-xs text-muted">
						No content indexed yet. Click Re-fetch to retry fetching.
					</div>
				) : (
					<DocsEditor
						value={isEditingPage ? pageDraftMarkdown : activePage?.markdown || ""}
						onChange={setPageDraftMarkdown}
						isDisabled={!canEdit || !isEditingPage}
						mode={pageEditorMode}
						onModeChange={setPageEditorMode}
						defaultMode={isEditingPage ? "write" : "preview"}
					/>
				)}
			</div>
		</div>
	);
}
