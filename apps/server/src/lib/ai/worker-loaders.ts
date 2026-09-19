import { eq } from "drizzle-orm";
import type z from "zod";
import type { integrationsGroupSchema } from "../../api/v1/integrations/schemas";
import { db } from "../../db";
import { appConfigEntity, blocksEntity, edgesEntity, integrationsEntity } from "../../db/schema";
import type { BlockSchema } from "./schemas";

// ─── Types ───────────────────────────────────────────────────────────────────

type CanvasItem = z.infer<typeof BlockSchema>;

type IntegrationListItem = {
	id: string;
	name: string;
	group: z.infer<typeof integrationsGroupSchema>;
	variant: string;
};

type ConfigListItem = {
	name: string;
	description: string;
};

// ─── Canvas Items Loader ─────────────────────────────────────────────────────

/**
 * Loads all blocks for a route from the DB and transforms them
 * into the BlockSchema-compatible shape the AI state expects.
 *
 * Edges are joined to produce the `connections` array on each block.
 */
export async function loadCanvasItems(routeId: string): Promise<CanvasItem[]> {
	const [blocks, edges] = await Promise.all([
		db.select().from(blocksEntity).where(eq(blocksEntity.routeId, routeId)),
		db.select().from(edgesEntity).where(eq(edgesEntity.routeId, routeId)),
	]);

	return blocks.map((block) => {
		const blockData = (block.data as Record<string, any>) ?? {};

		// Build connections array from outgoing edges for this block
		const connections = edges
			.filter((e) => e.from === block.id && e.to)
			.map((e) => ({
				blockId: e.to!,
				// Map the fromHandle DB string to a valid HandleTypeSchema value
				handle: normalizeHandle(e.fromHandle),
			}));

		return {
			id: block.id,
			blockType: block.type ?? "unknown",
			blockName: blockData.blockName ?? undefined,
			blockDescription: blockData.blockDescription ?? undefined,
			data: blockData,
			position: block.position ?? { x: 0, y: 0 },
			connections,
		} satisfies CanvasItem;
	});
}

// ─── Integrations List Loader ────────────────────────────────────────────────

/**
 * Loads all non-AI integrations for the project of the given route.
 * Returned shape matches the `integrationsList` field in AgentStateSchema.
 */
export async function loadIntegrationsList(projectId: string): Promise<IntegrationListItem[]> {
	const rows = await db.select().from(integrationsEntity);

	return rows
		.filter((r) => r.group !== "ai") // exclude AI connectors from the list
		.map((r) => ({
			id: r.id,
			name: r.name ?? r.id,
			group: (r.group ?? "database") as IntegrationListItem["group"],
			variant: r.variant ?? "",
		}));
}

// ─── Configs List Loader ─────────────────────────────────────────────────────

/**
 * Loads all app config entries from the DB.
 * Returned shape matches the `configsList` field in AgentStateSchema.
 */
export async function loadConfigsList(): Promise<ConfigListItem[]> {
	const rows = await db.select().from(appConfigEntity);

	return rows
		.filter((r) => r.keyName)
		.map((r) => ({
			name: r.keyName!,
			description: r.description ?? r.keyName!,
		}));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_HANDLES = ["source", "executor", "failure", "success"] as const;
type ValidHandle = (typeof VALID_HANDLES)[number];

function normalizeHandle(raw: string | null | undefined): ValidHandle {
	if (raw && VALID_HANDLES.includes(raw as ValidHandle)) {
		return raw as ValidHandle;
	}
	return "source";
}
