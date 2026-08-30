import { useNavigate } from "@tanstack/react-router";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { EntitySwitcher } from "@/components/common/EntitySwitcher";

/** The shared canvas header nav, filled with this project's custom blocks. */
export function CustomBlockSwitcher({
	projectId,
	blockId,
}: {
	projectId: string;
	blockId: string;
}) {
	const navigate = useNavigate();
	const { data, isLoading } = customBlocksQuery.getAll.useQuery(projectId);

	return (
		<EntitySwitcher
			backLabel="Custom blocks"
			noun="custom block"
			currentId={blockId}
			isLoading={isLoading}
			onBack={() => navigate({ to: "/$projectId/custom-blocks", params: { projectId } })}
			onSelect={(id) =>
				navigate({
					to: "/$projectId/custom-block-canvas/$blockId",
					params: { projectId, blockId: id },
				})
			}
			items={(data ?? []).map((block) => ({
				id: block.id,
				textValue: `${block.label} ${block.name}`,
				label: (
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate text-xs">{block.label}</span>
						<span className="truncate font-mono text-[11px] text-muted">{block.name}</span>
					</span>
				),
			}))}
		/>
	);
}
