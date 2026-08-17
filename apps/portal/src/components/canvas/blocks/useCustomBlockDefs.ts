import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import type { IconValue } from "@/components/customBlocks/IconPicker";

export type CustomBlockDef = {
	id: string;
	/** The block type on canvas — what the engine looks up. */
	name: string;
	label: string;
	description?: string;
	icon?: IconValue["icon"];
	iconUrl?: string;
	sourceType?: string | null;
	/** This is the block whose canvas is open: adding it would be recursion. */
	isSelf?: boolean;
};

/**
 * The project's custom blocks, shaped like catalog entries so the picker and the
 * node can render them. On a custom block's own canvas (`blockId` in the route)
 * that block is flagged `isSelf` — the picker offers it disabled rather than
 * letting a block call itself.
 */
export function useCustomBlockDefs(): CustomBlockDef[] {
	const params = useParams({ strict: false }) as {
		projectId?: string;
		blockId?: string;
	};
	const projectId = params?.projectId ?? "";
	const { data } = customBlocksQuery.getAll.useQuery(projectId);

	return useMemo(() => {
		if (!data) return [];
		return data.map((block) => ({
			id: block.id,
			name: block.name,
			label: block.label || block.name,
			description: block.description ?? undefined,
			icon: (block.icon as IconValue["icon"]) ?? undefined,
			iconUrl: block.iconUrl ?? undefined,
			sourceType: block.sourceType,
			isSelf: block.id === params?.blockId,
		}));
	}, [data, params?.blockId]);
}
