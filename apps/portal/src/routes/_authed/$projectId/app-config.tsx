import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Spinner, toast } from "@fluxify/components";
import { TbSearch, TbTrash } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CreateConfigButton } from "@/components/appConfig/CreateConfigModal";
import { EditConfigModal } from "@/components/appConfig/EditConfigModal";
import { AppConfigTable } from "@/components/appConfig/AppConfigTable";
import type { ConfigRow, SortBy } from "@/components/appConfig/types";

export const Route = createFileRoute("/_authed/$projectId/app-config")({
	component: AppConfigPage,
});

function AppConfigPage() {
	const { projectId } = Route.useParams();
	const [page, setPage] = useState(1);
	const [perPage, setPerPage] = useState(20);
	const [searchInput, setSearchInput] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
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
		if (sortBy === column) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(column);
			setSortOrder("asc");
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Top Header */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">App Config</h1>
					<p className="text-sm text-muted">
						Key-value settings and secrets available across your project routes.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{selectedIds.size > 0 && (
						<Button
							variant="danger"
							onPress={() => setPendingBulkDelete(true)}
						>
							<TbTrash size={16} /> Delete ({selectedIds.size})
						</Button>
					)}
					<CreateConfigButton projectId={projectId} />
				</div>
			</div>

			{/* Search & Toolbar */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative w-full max-w-sm">
					<TbSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
					<input
						type="text"
						placeholder="Search config by key name..."
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
					/>
				</div>
				<div className="flex items-center gap-2 text-sm text-muted">
					<span>Rows per page:</span>
					<select
						value={perPage}
						onChange={(e) => {
							setPerPage(Number(e.target.value));
							setPage(1);
						}}
						className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none"
					>
						<option value={10}>10</option>
						<option value={20}>20</option>
						<option value={50}>50</option>
						<option value={100}>100</option>
					</select>
				</div>
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
					{debouncedSearch ? `No configurations found matching "${debouncedSearch}"` : "No config keys yet."}
				</p>
			) : (
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
			)}

			{/* Pagination Controls */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between border-t border-border pt-4 text-sm text-muted">
					<div>
						Showing page <b>{page}</b> of <b>{totalPages}</b>
					</div>
					<div className="flex items-center gap-2">
						<Button variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
							Previous
						</Button>
						<Button variant="outline" isDisabled={page >= totalPages} onPress={() => setPage((p) => p + 1)}>
							Next
						</Button>
					</div>
				</div>
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
				Delete key <b className="text-foreground">{pendingDelete?.keyName}</b>? This cannot be undone.
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
				Are you sure you want to delete <b className="text-foreground">{selectedIds.size}</b> selected configuration key(s)? This action cannot be undone.
			</ConfirmDialog>
		</div>
	);
}
