import { DeleteButton, Input, Spinner, TextField, toast } from "@fluxify/components";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TbSearch } from "react-icons/tb";
import { z } from "zod";
import { AppConfigTable } from "@/components/appConfig/AppConfigTable";
import { CreateConfigButton } from "@/components/appConfig/CreateConfigModal";
import { EditConfigModal } from "@/components/appConfig/EditConfigModal";
import type { ConfigRow, SortBy } from "@/components/appConfig/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageFooter } from "@/components/common/PageFooter";
import { showErrorNotification } from "@/lib/errorNotifier";
import { usePageSize } from "@/lib/pageSize";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { appConfigQuery } from "@/query/appConfigQuery";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/app-config")({
	head: createRouteHead(
		"App Config",
		"Manage environment variables, configuration keys, and secrets for your project.",
	),
	// `?q=` deep-links to one key — the AI chips send the user straight to the
	// config a plan referenced instead of dropping them on an unfiltered table.
	validateSearch: z.object({ q: z.string().optional() }),
	component: AppConfigPage,
});

export function AppConfigPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "App Config"));
	const { q } = Route.useSearch();
	const [page, setPage] = useState(1);
	const [perPage, setPerPage] = usePageSize("appConfig", 20);
	const [searchInput, setSearchInput] = useState(q ?? "");
	const [debouncedSearch, setDebouncedSearch] = useState(q ?? "");
	const [sortBy, setSortBy] = useState<SortBy>("keyName");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

	const [editingConfig, setEditingConfig] = useState<ConfigRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<ConfigRow | null>(null);
	const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchInput);
			setPage(1);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput]);

	const { data, isLoading, isError } = appConfigQuery.getAll.useQuery(projectId, {
		page,
		perPage,
		search: debouncedSearch,
		sortBy,
		sort: sortOrder,
	});

	const remove = appConfigQuery.remove.mutation(projectId);
	const deleteBulk = appConfigQuery.deleteBulk.mutation(projectId);

	const items = (data?.data ?? []) as ConfigRow[];
	const totalPages = data?.pagination?.totalPages ?? 1;

	function handleSort(column: SortBy) {
		setPage(1);
		if (sortBy === column) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(column);
			setSortOrder("asc");
		}
	}

	return (
		<div className="flex h-[calc(100vh-3rem)] flex-col gap-4 overflow-hidden">
			{/* Top Header */}
			<div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">App Config</h1>
					<p className="text-sm text-muted">
						Key-value settings and secrets available across your project routes.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{selectedIds.size > 0 && (
						<DeleteButton onPress={() => setPendingBulkDelete(true)}>
							Delete ({selectedIds.size})
						</DeleteButton>
					)}
					<CreateConfigButton projectId={projectId} />
				</div>
			</div>

			{/* Search & Toolbar */}
			<div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<TextField
					aria-label="Search config by key name"
					value={searchInput}
					onChange={setSearchInput}
					className="relative w-full max-w-sm"
				>
					<TbSearch
						className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted"
						size={16}
					/>
					<Input placeholder="Search config by key name..." className="pl-9" />
				</TextField>
			</div>

			{/* Table Content */}
			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load app config.</p>
			) : items.length === 0 ? (
				<p className="py-16 text-center text-muted">
					{debouncedSearch
						? `No configurations found matching "${debouncedSearch}"`
						: "No config keys yet."}
				</p>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<AppConfigTable
						items={items}
						selectedIds={selectedIds}
						onSelectionChange={setSelectedIds}
						sortBy={sortBy}
						sortOrder={sortOrder}
						onSort={handleSort}
						onEdit={setEditingConfig}
						onDelete={setPendingDelete}
					/>
				</div>
			)}

			{items.length > 0 && (
				<PageFooter
					page={page}
					totalPages={totalPages}
					perPage={perPage}
					onPage={setPage}
					onPerPage={(n) => {
						setPerPage(n);
						setPage(1);
					}}
				/>
			)}

			{/* Edit Config Modal */}
			{editingConfig && (
				<EditConfigModal
					projectId={projectId}
					config={editingConfig}
					onClose={() => setEditingConfig(null)}
				/>
			)}

			{/* Single Delete Confirm Dialog */}
			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(o) => !o && setPendingDelete(null)}
				title="Delete config key?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => {
							toast.success("Config deleted");
							setSelectedIds((prev) => {
								const next = new Set(prev);
								next.delete(pendingDelete.id);
								return next;
							});
							setPendingDelete(null);
						},
						onError: (e) => showErrorNotification(e as Error),
					});
				}}
			>
				Delete key <b className="text-foreground">{pendingDelete?.keyName}</b>? This cannot be
				undone.
			</ConfirmDialog>

			{/* Bulk Delete Confirm Dialog */}
			<ConfirmDialog
				open={pendingBulkDelete}
				onOpenChange={(o) => !o && setPendingBulkDelete(false)}
				title="Delete selected configs?"
				danger
				confirmText={`Delete ${selectedIds.size} items`}
				pending={deleteBulk.isPending}
				onConfirm={() => {
					deleteBulk.mutate(
						{ ids: Array.from(selectedIds) },
						{
							onSuccess: () => {
								toast.success(`Deleted ${selectedIds.size} config items`);
								setSelectedIds(new Set());
								setPendingBulkDelete(false);
							},
							onError: (e) => showErrorNotification(e as Error),
						},
					);
				}}
			>
				Are you sure you want to delete <b className="text-foreground">{selectedIds.size}</b>{" "}
				selected configuration key(s)? This action cannot be undone.
			</ConfirmDialog>
		</div>
	);
}
