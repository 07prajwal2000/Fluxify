import { generateID } from "@fluxify/lib";
import type z from "zod";
import type { BuilderOutputSchema, CanvasChangeSchema } from "./schemas";

export function mapBuilderOutput(builderOutput: z.infer<typeof BuilderOutputSchema>): {
	blocks: {
		id: string;
		type: string;
		data: any;
		position: { x: number; y: number };
	}[];
	edges: {
		id: string;
		from: string;
		to: string;
		fromHandle: string;
		toHandle: string;
	}[];
	changes: z.infer<typeof CanvasChangeSchema>[];
} {
	const idMap = new Map<string, string>();
	const blocks: any[] = [];
	const edges: any[] = [];

	const isUUID = (id: string) =>
		/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);

	const getId = (id: string) => {
		if (isUUID(id)) return id;
		if (!idMap.has(id)) {
			idMap.set(id, generateID());
		}
		return idMap.get(id)!;
	};

	// First pass: generate UUIDs for all new blocks
	for (const block of builderOutput.blocks) {
		getId(block.id);
	}

	for (const block of builderOutput.blocks) {
		const newBlockId = getId(block.id);

		blocks.push({
			id: newBlockId,
			type: block.blockType,
			data: {
				...block.data,
				...(block.blockName && { blockName: block.blockName }),
				...(block.blockDescription && {
					blockDescription: block.blockDescription,
				}),
			},
			position: block.position,
		});

		if (block.connections) {
			for (const conn of block.connections) {
				edges.push({
					id: generateID(),
					from: newBlockId,
					to: getId(conn.blockId),
					fromHandle: conn.handle,
					toHandle: "target",
				});
			}
		}
	}

	// Third pass: remap IDs in canvasChanges if any
	const changes = (builderOutput.canvasChanges || []).map((change) => {
		if (change.type === "edge_swap") {
			return {
				...change,
				data: {
					...change.data,
					fromEdge: getId(change.data.fromEdge),
					toEdge: getId(change.data.toEdge),
				},
			};
		}
		if (change.type === "block_remove") {
			return {
				...change,
				data: {
					...change.data,
					blocks: change.data.blocks.map(getId),
				},
			};
		}
		if (change.type === "block_change") {
			return {
				...change,
				data: {
					...change.data,
					blocksInfo: change.data.blocksInfo.map((bInfo) => ({
						...bInfo,
						id: getId(bInfo.id),
						connections: bInfo.connections.map((c) => ({
							...c,
							blockId: getId(c.blockId),
						})),
					})),
				},
			};
		}
		return change;
	});

	return {
		blocks,
		edges,
		changes: changes as z.infer<typeof CanvasChangeSchema>[],
	};
}
