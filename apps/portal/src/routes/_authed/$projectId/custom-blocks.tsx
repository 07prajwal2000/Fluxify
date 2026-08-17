import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Button,
	DeleteIconButton,
	Input,
	Label,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { TbBoxMultiple, TbPlus, TbSearch } from "react-icons/tb";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { createRouteHead } from "@/lib/seo";
import { BaseBlock } from "@/components/canvas/blocks/BaseBlock";
import { CustomBlockIcon, type IconValue } from "@/components/customBlocks/IconPicker";

export const Route = createFileRoute("/_authed/$projectId/custom-blocks")({
	head: createRouteHead(
		"Custom Blocks",
		"Manage custom reusable workflow blocks for your project.",
	),
	component: CustomBlocksPage,
});

type Block = NonNullable<
	ReturnType<typeof customBlocksQuery.getAll.useQuery>["data"]
>[number];

function CustomBlocksPage() {
	const { projectId } = Route.useParams();
	const { data, isLoading, isError } = customBlocksQuery.getAll.useQuery(projectId);
	const remove = customBlocksQuery.remove.mutation(projectId);
	const navigate = useNavigate();
	const [pendingDelete, setPendingDelete] = useState<Block | null>(null);
	const [search, setSearch] = useState("");

	const blocks = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!data) return [];
		if (!q) return data;
		return data.filter((b) =>
			[b.label, b.name, b.description ?? ""].some((v) => v.toLowerCase().includes(q)),
		);
	}, [data, search]);

	function openCanvas(blockId: string) {
		navigate({
			to: "/$projectId/custom-block-canvas/$blockId",
			params: { projectId, blockId },
		});
	}

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Custom Blocks</h1>
					<p className="text-sm text-muted">
						Reusable blocks for your flows. Click one to open its canvas.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{data && data.length > 0 && (
						<TextField value={search} onChange={setSearch} className="w-56">
							<Label className="sr-only">Search custom blocks</Label>
							<Input placeholder="Search blocks" />
						</TextField>
					)}
					<Button
						variant="primary"
						onPress={() =>
							navigate({ to: "/$projectId/custom-blocks/new", params: { projectId } })
						}
					>
						<TbPlus size={16} /> New block
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load custom blocks.</p>
			) : !data || data.length === 0 ? (
				<EmptyState
					icon={<TbBoxMultiple size={28} />}
					title="No custom blocks yet"
					description="A custom block wraps a piece of flow you want to reuse across routes."
				/>
			) : blocks.length === 0 ? (
				<EmptyState
					icon={<TbSearch size={28} />}
					title={`No block matches “${search}”`}
					description="Try a different name or description."
				/>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
					{blocks.map((block) => (
						<div
							key={block.id}
							role="button"
							tabIndex={0}
							onClick={() => openCanvas(block.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									openCanvas(block.id);
								}
							}}
							className="group relative flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
						>
							{/* the block exactly as it renders on a canvas */}
							<div className="pointer-events-none flex justify-center rounded-md bg-background-secondary px-3 py-5">
								<BaseBlock
									blockId={block.id}
									blockType="custom"
									name={block.label}
									description={block.description ?? undefined}
									icon={
										<CustomBlockIcon
											icon={(block.icon as IconValue["icon"]) ?? undefined}
											iconUrl={block.iconUrl ?? undefined}
										/>
									}
									showToolbar={false}
								/>
							</div>

							<div className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<p className="truncate font-mono text-xs text-muted">{block.name}</p>
									<p className="mt-0.5 text-xs text-muted">
										{Array.isArray(block.inputParams) ? block.inputParams.length : 0} input
										{(Array.isArray(block.inputParams) ? block.inputParams.length : 0) === 1
											? ""
											: "s"}
										{block.sourceType && block.sourceType !== "user-defined"
											? ` · ${block.sourceType}`
											: ""}
									</p>
								</div>
								{block.sourceType !== "plugin" && (
									<div
										className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
										onClick={(e) => e.stopPropagation()}
										onKeyDown={(e) => e.stopPropagation()}
									>
										<DeleteIconButton
											aria-label={`Delete ${block.label}`}
											onPress={() => setPendingDelete(block)}
										/>
									</div>
								)}
							</div>
						</div>
					))}
				</div>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(o) => !o && setPendingDelete(null)}
				title="Delete custom block?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Block deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.label}</b>? This can't be undone.
			</ConfirmDialog>
		</div>
	);
}

function EmptyState({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
			<span className="text-muted">{icon}</span>
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="max-w-sm text-xs text-muted">{description}</p>
		</div>
	);
}

