import { Spinner } from "@fluxify/components";
import type { ReactNode } from "react";
import { TbArrowDown, TbLogin2, TbLogout2 } from "react-icons/tb";
import { blockIcon } from "@/components/middlewares/ChainEditor";
import { customBlocksQuery } from "@/query/customBlocksQuery";

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
 * A middleware version's chain (#740), read-only: its ordered custom blocks,
 * top to bottom. The ids come from the version's snapshot, the names and icons
 * from the project's current blocks, so a block deleted since shows as such.
 */
export function VersionChain({ projectId, chain }: { projectId: string; chain: string[] }) {
	const { data, isLoading } = customBlocksQuery.getAll.useQuery(projectId);
	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner />
			</div>
		);
	}
	const byId = new Map((data ?? []).map((block) => [block.id, block]));
	return (
		<section
			aria-label="Version chain"
			className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto p-6"
		>
			<Terminal icon={<TbLogin2 size={14} />}>Request comes in</Terminal>
			<Connector />
			{chain.length === 0 ? (
				<p className="text-sm text-muted">Empty. It passes its input straight on.</p>
			) : (
				<ol className="flex w-full max-w-md flex-col gap-2">
					{chain.map((id, position) => {
						const block = byId.get(id);
						return (
							<li
								key={id}
								className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
							>
								<span className="text-xs text-muted">{position + 1}</span>
								{block && blockIcon(block)}
								<span className="min-w-0 truncate text-sm font-medium text-foreground">
									{block ? block.label || block.name : "Deleted block"}
								</span>
							</li>
						);
					})}
				</ol>
			)}
			<Connector />
			<Terminal icon={<TbLogout2 size={14} />}>Next middleware, or the route</Terminal>
		</section>
	);
}
