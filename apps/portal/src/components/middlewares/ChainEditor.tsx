import { ReorderableList } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import {
	TbArrowDown,
	TbBoxMultiple,
	TbExternalLink,
	TbLogin2,
	TbLogout2,
	TbPlus,
} from "react-icons/tb";
import { CustomBlockIcon, type IconValue } from "@/components/customBlocks/IconPicker";
import { PickerModal } from "@/components/middlewares/PickerModal";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import type { Middleware } from "@/services/middlewares";

export type ChainBlock = Middleware["blocks"][number];

export const blockIcon = (block: { icon?: string | null; iconUrl?: string | null }) => (
	<CustomBlockIcon
		icon={(block.icon as IconValue["icon"]) ?? undefined}
		iconUrl={block.iconUrl ?? undefined}
	/>
);

/** Start and end of the chain, so it reads as a flow and not a bare list. */
function Terminal({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-center gap-2 self-center rounded-full border border-border bg-surface-secondary px-3 py-1 text-xs text-muted">
			{icon}
			{children}
		</div>
	);
}

const Connector = () => <TbArrowDown size={14} className="self-center text-muted" aria-hidden />;

/**
 * A middleware's chain of custom blocks, top to bottom (#534). Used by the
 * create wizard and the edit page, so both show the same flow.
 */
export function ChainEditor({
	projectId,
	chain,
	onChange,
}: {
	projectId: string;
	chain: ChainBlock[];
	onChange: (next: ChainBlock[]) => void;
}) {
	const { data: customBlocks } = customBlocksQuery.getAll.useQuery(projectId);
	const [picking, setPicking] = useState(false);

	// only middleware blocks can be chained, and each one once
	const candidates = useMemo(
		() =>
			(customBlocks ?? [])
				.filter((b) => b.usage === "middleware")
				.map((b) => ({
					id: b.id,
					label: b.label || b.name,
					description: b.description,
					icon: blockIcon(b),
					disabledReason: chain.some((c) => c.id === b.id) ? "Already in this chain" : undefined,
					block: b,
				})),
		[customBlocks, chain],
	);

	return (
		<div className="flex flex-col gap-2">
			<Terminal icon={<TbLogin2 size={14} />}>Request comes in</Terminal>
			<Connector />
			{chain.length > 0 && (
				<>
					<ReorderableList
						items={chain}
						getKey={(b) => b.id}
						showIndex
						onReorder={onChange}
						onRemove={(b) => onChange(chain.filter((c) => c.id !== b.id))}
						removeButtonAriaLabel="Remove from chain"
						// a new tab, so unsaved chain edits here survive a look at the block
						renderActions={(b) => (
							<Link
								to="/$projectId/custom-block-canvas/$blockId"
								params={{ projectId, blockId: b.id }}
								target="_blank"
								rel="noreferrer"
								title="Open canvas in a new tab"
								aria-label={`Open ${b.label || b.name} canvas in a new tab`}
								className="flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
							>
								<TbExternalLink size={16} />
							</Link>
						)}
						renderItemContent={(b) => (
							<span className="flex min-w-0 items-center gap-3">
								{blockIcon(b)}
								<span className="min-w-0">
									<span className="block truncate text-sm font-medium text-foreground">
										{b.label || b.name}
									</span>
									<span className="block truncate text-xs text-muted">
										{b.description || b.name}
									</span>
								</span>
							</span>
						)}
					/>
					<Connector />
				</>
			)}
			<button
				type="button"
				onClick={() => setPicking(true)}
				className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted transition-colors hover:border-accent hover:bg-accent/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				<TbPlus size={16} />
				{chain.length === 0 ? "Add the first block" : "Add block"}
			</button>
			<Connector />
			<Terminal icon={<TbLogout2 size={14} />}>Next middleware, or the route</Terminal>

			<PickerModal
				open={picking}
				onOpenChange={setPicking}
				title="Add a block to the chain"
				description="Only custom blocks set to be used for Middleware can be added."
				icon={<TbBoxMultiple size={20} />}
				searchPlaceholder="Search blocks…"
				items={candidates}
				empty={
					<>
						No middleware blocks yet. Create a custom block and set <b>Used for</b> to{" "}
						<b>Middleware</b>.{" "}
						<Link
							to="/$projectId/custom-blocks/new"
							params={{ projectId }}
							className="text-accent hover:underline"
						>
							New custom block
						</Link>
					</>
				}
				onPick={(item) => {
					const b = candidates.find((c) => c.id === item.id)?.block;
					if (b)
						onChange([
							...chain,
							{
								...b,
								description: b.description ?? null,
								icon: b.icon ?? null,
								iconUrl: b.iconUrl ?? null,
							},
						]);
				}}
			/>
		</div>
	);
}
