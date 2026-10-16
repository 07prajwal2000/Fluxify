import {
	Alert,
	Button,
	Chip,
	DeleteButton,
	Input,
	Label,
	Spinner,
	Switch,
	toast,
} from "@fluxify/components";
import { useEffect, useState } from "react";
import {
	TbAlertCircle,
	TbCheck,
	TbClock,
	TbFileText,
	TbLink,
	TbListCheck,
	TbRefresh,
	TbWorld,
} from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DocsEditor } from "@/components/customBlocks/DocsEditor";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { knowledgeSourcesQuery } from "@/query/knowledgeSourcesQuery";
import type { KnowledgeSourceType } from "@/services/knowledgeSources";
import { HeaderMappingEditor } from "./HeaderMappingEditor";
import { KnowledgeSourcePagesEditor } from "./KnowledgeSourcePagesEditor";

const TYPE_ICONS: Record<
	KnowledgeSourceType,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	markdown: TbFileText,
	url: TbLink,
	llms_txt: TbListCheck,
	llms_full_txt: TbWorld,
};

const TYPE_LABELS: Record<KnowledgeSourceType, string> = {
	markdown: "Markdown",
	url: "URL",
	llms_txt: "llms.txt",
	llms_full_txt: "llms-full.txt",
};

interface KnowledgeSourceDetailPaneProps {
	projectId: string;
	sourceId: string;
	canEdit: boolean;
	onDeleted: () => void;
}

export function KnowledgeSourceDetailPane({
	projectId,
	sourceId,
	canEdit,
	onDeleted,
}: KnowledgeSourceDetailPaneProps) {
	const { data: source, isLoading } = knowledgeSourcesQuery.getById.useQuery(projectId, sourceId);

	const updateMutation = knowledgeSourcesQuery.update.mutation(projectId);
	const refetchMutation = knowledgeSourcesQuery.refetch.mutation(projectId);
	const removeMutation = knowledgeSourcesQuery.remove.mutation(projectId);

	// Editable state
	const [name, setName] = useState("");
	const [content, setContent] = useState("");
	const [url, setUrl] = useState("");
	const [headers, setHeaders] = useState<Record<string, string>>({});
	const [enabled, setEnabled] = useState(true);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Re-fetch confirmation state
	const [refetchConfirmOpen, setRefetchConfirmOpen] = useState(false);
	const [pendingRefetchAction, setPendingRefetchAction] = useState<"refetch" | "save" | null>(null);

	// Sync state from query data
	useEffect(() => {
		if (source) {
			setName(source.name);
			setUrl(source.url ?? "");
			setHeaders(source.headers ?? {});
			setEnabled(source.enabled);
			setContent(source.pages[0]?.markdown ?? "");
			setError(null);
		}
	}, [source]);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center p-8">
				<Spinner />
			</div>
		);
	}

	if (!source) {
		return (
			<div className="flex h-full items-center justify-center p-8 text-sm text-muted">
				Knowledge source not found.
			</div>
		);
	}

	const isMarkdown = source.type === "markdown";
	const editedPagesCount = source.pages.filter((p) => p.edited).length;
	const isModified = isMarkdown
		? content !== (source.pages[0]?.markdown ?? "") ||
			name !== source.name ||
			enabled !== source.enabled
		: url !== (source.url ?? "") ||
			JSON.stringify(headers) !== JSON.stringify(source.headers ?? {}) ||
			enabled !== source.enabled ||
			name !== source.name;

	async function executeSave() {
		setError(null);
		try {
			if (isMarkdown) {
				await updateMutation.mutateAsync({
					id: source!.id,
					body: {
						name: name.trim(),
						type: "markdown",
						content,
						enabled,
					},
				});
			} else {
				await updateMutation.mutateAsync({
					id: source!.id,
					body: {
						name: name.trim(),
						type: source!.type,
						url: url.trim(),
						headers,
						selectedPages: source!.selectedPages,
						enabled,
					},
				});
			}
			toast.success("Knowledge source saved");
		} catch (err) {
			const parsed = parseApiError(err);
			setError(parsed.message);
			showErrorNotification(err);
		}
	}

	function handleSave() {
		setError(null);
		if (!name.trim()) {
			setError("Name is required.");
			return;
		}

		const willRefetch =
			!isMarkdown &&
			(url.trim() !== (source!.url ?? "") ||
				JSON.stringify(headers) !== JSON.stringify(source!.headers ?? {}));

		if (willRefetch && editedPagesCount > 0) {
			setPendingRefetchAction("save");
			setRefetchConfirmOpen(true);
		} else {
			executeSave();
		}
	}

	async function handleRefetch() {
		setError(null);
		try {
			await refetchMutation.mutateAsync(source!.id);
			toast.success("Knowledge source re-fetched");
		} catch (err) {
			const parsed = parseApiError(err);
			setError(parsed.message);
			showErrorNotification(err);
		}
	}

	function handleRefetchClick() {
		if (editedPagesCount > 0) {
			setPendingRefetchAction("refetch");
			setRefetchConfirmOpen(true);
		} else {
			handleRefetch();
		}
	}

	async function handleConfirmRefetchAction() {
		setRefetchConfirmOpen(false);
		if (pendingRefetchAction === "refetch") {
			await handleRefetch();
		} else if (pendingRefetchAction === "save") {
			await executeSave();
		}
		setPendingRefetchAction(null);
	}

	async function handleDelete() {
		try {
			setDeleteDialogOpen(false);
			onDeleted();
			await removeMutation.mutateAsync(sourceId);
			toast.success("Knowledge source deleted");
		} catch (err) {
			showErrorNotification(err);
		}
	}

	async function handleToggleEnabled(nextEnabled: boolean) {
		setEnabled(nextEnabled);
		if (!canEdit) return;
		try {
			await updateMutation.mutateAsync({
				id: source!.id,
				body: {
					name: name.trim() || source!.name,
					type: source!.type,
					url: source!.url ?? undefined,
					headers: source!.headers,
					selectedPages: source!.selectedPages,
					content: isMarkdown ? content || source!.pages[0]?.markdown : undefined,
					enabled: nextEnabled,
				},
			});
			toast.success(nextEnabled ? "Knowledge source enabled" : "Knowledge source disabled");
		} catch (err) {
			setEnabled(source!.enabled);
			showErrorNotification(err);
		}
	}

	const TypeIcon = TYPE_ICONS[source.type];

	return (
		<div className="flex h-full min-h-0 flex-col gap-5 p-6 overflow-y-auto">
			{/* Header bar */}
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-secondary">
						<TypeIcon size={18} className="text-foreground" />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<h2 className="text-lg font-semibold tracking-tight text-foreground font-mono">
								{source.name}
							</h2>
							<Chip size="sm" variant="secondary" className="text-[11px]">
								{TYPE_LABELS[source.type]}
							</Chip>
						</div>
						<div className="flex items-center gap-2 text-xs text-muted">
							<span>
								{source.pageCount} {source.pageCount === 1 ? "page" : "pages"} indexed
							</span>
							{source.lastFetchedAt && (
								<>
									<span>•</span>
									<span className="flex items-center gap-1">
										<TbClock size={12} />
										Last fetched {new Date(source.lastFetchedAt).toLocaleString()}
									</span>
								</>
							)}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<Switch
						isSelected={enabled}
						isDisabled={!canEdit}
						onChange={(e: any) => handleToggleEnabled(e.target ? e.target.checked : Boolean(e))}
						label="Enabled"
					/>
					{canEdit && isModified && (
						<Button
							variant="primary"
							size="sm"
							isPending={updateMutation.isPending}
							onPress={handleSave}
						>
							Save changes
						</Button>
					)}
					{!isMarkdown && canEdit && (
						<Button
							variant="outline"
							size="sm"
							isPending={refetchMutation.isPending}
							onPress={handleRefetchClick}
						>
							<TbRefresh size={14} className="mr-1" /> Re-fetch
						</Button>
					)}
					{canEdit && (
						<DeleteButton
							size="sm"
							onPress={() => setDeleteDialogOpen(true)}
							aria-label="Delete source"
						>
							Delete
						</DeleteButton>
					)}
				</div>
			</div>

			{/* Inline Error alert if error */}
			{error && (
				<Alert status="danger">
					<Alert.Indicator>
						<TbAlertCircle size={16} />
					</Alert.Indicator>
					<Alert.Content>
						<Alert.Description>{error}</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			{/* Background fetch error notice */}
			{source.lastFetchStatus === "error" && source.lastFetchError && (
				<Alert status="danger">
					<Alert.Indicator>
						<TbAlertCircle size={16} />
					</Alert.Indicator>
					<Alert.Content>
						<Alert.Title>Last fetch failed</Alert.Title>
						<Alert.Description>{source.lastFetchError}</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			{/* Source Name */}
			<div className="flex flex-col gap-1 max-w-xl">
				<Label className="text-xs font-semibold uppercase tracking-wider text-muted">Name</Label>
				<Input
					value={name}
					disabled={!canEdit}
					onChange={(e) => setName(e.target.value)}
					className="text-xs font-mono"
				/>
			</div>

			{/* For URL / LLMS sources: URL & Headers */}
			{!isMarkdown && (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1 max-w-xl">
						<Label className="text-xs font-semibold uppercase tracking-wider text-muted">
							Source URL
						</Label>
						<Input
							value={url}
							disabled={!canEdit}
							onChange={(e) => setUrl(e.target.value)}
							className="text-xs"
						/>
					</div>

					<HeaderMappingEditor
						projectId={projectId}
						headers={headers}
						onChange={setHeaders}
						isDisabled={!canEdit}
					/>
				</div>
			)}

			{/* Content / Markdown Preview Section */}
			{isMarkdown ? (
				<div className="flex min-h-0 flex-1 flex-col gap-2">
					<Label className="text-xs font-semibold uppercase tracking-wider text-muted">
						Markdown Content
					</Label>
					<div className="flex min-h-[350px] flex-1 flex-col">
						<DocsEditor value={content} onChange={setContent} isDisabled={!canEdit} />
					</div>
				</div>
			) : (
				<KnowledgeSourcePagesEditor projectId={projectId} source={source} canEdit={canEdit} />
			)}

			{/* Re-fetch Confirm Dialog */}
			<ConfirmDialog
				open={refetchConfirmOpen}
				onOpenChange={(open) => {
					setRefetchConfirmOpen(open);
					if (!open) setPendingRefetchAction(null);
				}}
				title={
					pendingRefetchAction === "refetch" ? "Re-fetch knowledge source" : "Save and re-fetch"
				}
				confirmText={pendingRefetchAction === "refetch" ? "Re-fetch" : "Save and re-fetch"}
				danger
				pending={refetchMutation.isPending || updateMutation.isPending}
				onConfirm={handleConfirmRefetchAction}
			>
				Re-fetching replaces {editedPagesCount} edited page{editedPagesCount === 1 ? "" : "s"}.
			</ConfirmDialog>

			{/* Delete Confirm Modal */}
			<ConfirmDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				title="Delete knowledge source"
				confirmText="Delete"
				danger
				pending={removeMutation.isPending}
				onConfirm={handleDelete}
			>
				Are you sure you want to delete the knowledge source <strong>"{source.name}"</strong>? This
				will remove all its indexed documentation from agent searches.
			</ConfirmDialog>
		</div>
	);
}
