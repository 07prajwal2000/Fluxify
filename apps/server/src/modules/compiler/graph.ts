import { type BlockDTOType, BlockTypes, type EdgeDTOSchemaType } from "@fluxify/blocks";
import { and, eq, ne } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { blocksEntity, type CanvasSnapshot, edgesEntity } from "../../db/schema";
import { parentColumn } from "../canvas/repository";
import type { CanvasParent } from "../canvas/types";

/**
 * The graph an environment serves (#739): development runs the working copy,
 * production the promoted version's snapshot. Saving the working copy never
 * reaches production, because production reads nothing but this snapshot.
 */
export function snapshotGraph(snapshot: Pick<CanvasSnapshot, "blocks" | "edges">) {
	return compilerGraph(
		snapshot.blocks.filter((block) => block.type !== BlockTypes.sticky_note),
		snapshot.edges,
	);
}

/**
 * Exported for the test runner: a suite runs the canvas as it is saved right
 * now, not the last published artifact, so it compiles the graph itself rather
 * than reading the artifact store.
 */
export async function loadGraph(parent: CanvasParent, tx: DbTransactionType | typeof db = db) {
	const blockRows = await tx
		.select()
		.from(blocksEntity)
		.where(
			and(
				eq(parentColumn(blocksEntity, parent.type), parent.id),
				ne(blocksEntity.type, BlockTypes.sticky_note),
			),
		);

	const edgeRows = await tx
		.select({
			id: edgesEntity.id,
			from: edgesEntity.from,
			to: edgesEntity.to,
			fromHandle: edgesEntity.fromHandle,
			toHandle: edgesEntity.toHandle,
		})
		.from(edgesEntity)
		.where(eq(parentColumn(edgesEntity, parent.type), parent.id));

	return compilerGraph(blockRows, edgeRows);
}

/** Stored rows as the compiler takes them; an ephemeral run (#741) builds them without a canvas. */
export function compilerGraph(
	blockRows: { id: string; type: string | null; position: unknown; data: unknown }[],
	edgeRows: {
		id: string;
		from: string | null;
		to: string | null;
		fromHandle: string | null;
		toHandle: string | null;
	}[],
) {
	const blocks: BlockDTOType[] = blockRows
		.filter((block) => block.type !== null)
		.map((block) => ({
			id: block.id,
			type: block.type as string,
			position: block.position as { x: number; y: number },
			data: block.data,
		}));

	// the loader swaps the handles; keep the compiler on the same convention
	const edges = edgeRows.map((edge) => ({
		id: edge.id as string,
		from: edge.from as string,
		to: edge.to as string,
		fromHandle: edge.toHandle as string,
		toHandle: edge.fromHandle as string,
	})) as EdgeDTOSchemaType;

	return { blocks, edges };
}
