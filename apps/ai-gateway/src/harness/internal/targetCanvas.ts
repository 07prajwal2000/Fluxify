import { logger } from "@fluxify/common";
import { buildContextBlock } from "./contextBlock";
import type { DbService } from "./dbService";
import type { ProjectInventoryEntry, SubAgentResult, Task } from "../types";
import type { HarnessJobMetadata } from "../queue";

type Target = NonNullable<HarnessJobMetadata["location"]>;

/** `internal.metadata` is the job metadata plus what the run resolved onto it. */
type RunMetadata = HarnessJobMetadata & {
	projectInventory?: ProjectInventoryEntry[];
	contextBlock?: string;
};

/**
 * A canvas agent cannot start until it knows which canvas it is editing, and
 * discovering that costs it two or three sequential tool calls: find_resource
 * by name for the id, then another for the canvas. Each round trip re-sends the
 * whole prompt, so on a slow model that is minutes of wall clock spent
 * rediscovering an id the run already has.
 *
 * Every source below is deterministic, so the resolution belongs here rather
 * than in the model's tool budget. `metadata.location` (the canvas the user was
 * looking at) is already resolved at run start; this covers the rest.
 */

function targetOf(result: SubAgentResult | undefined): Target | undefined {
	const value = (result ?? {}) as {
		action?: string;
		routeId?: string;
		customBlockId?: string;
		targetType?: string;
		targetId?: string;
	};
	if (value.action === "delete") return undefined;
	if (value.routeId) return { where: "route-canvas", id: value.routeId };
	if (value.customBlockId) {
		return { where: "custom-block-canvas", id: value.customBlockId };
	}
	// A prior block builder in the same chain already picked the target.
	if (value.targetId && value.targetType) {
		return value.targetType === "route"
			? { where: "route-canvas", id: value.targetId }
			: { where: "custom-block-canvas", id: value.targetId };
	}
	return undefined;
}

/** The task generator is told to copy exact inventory IDs into task text, so an
 *  ID quoted there names the target. Only when it names exactly one — two
 *  candidates is a genuine choice, and the model has the tools to make it. */
function targetFromInventory(
	task: Task,
	inventory: ProjectInventoryEntry[] | undefined,
): Target | undefined {
	const text = `${task.title} ${task.description}`;
	const hits = (inventory ?? []).filter(
		(entry) =>
			(entry.type === "route" || entry.type === "custom_block") &&
			text.includes(entry.id),
	);
	if (hits.length !== 1) return undefined;
	return hits[0].type === "route"
		? { where: "route-canvas", id: hits[0].id }
		: { where: "custom-block-canvas", id: hits[0].id };
}

function resolveTarget(
	task: Task,
	results: Record<string, SubAgentResult> | undefined,
	inventory: ProjectInventoryEntry[] | undefined,
): Target | undefined {
	// A declared dependency outranks the inventory: it is what this run just built.
	for (const id of task.dependsOnAgentId ?? []) {
		const target = targetOf(results?.[id]);
		if (target) return target;
	}
	return targetFromInventory(task, inventory);
}

/**
 * True when the canvas this task edits is already in front of the agent —
 * either the run resolved the target and prefetched it below, or the user has
 * it open and `contextBlock` carries it.
 *
 * Callers use this to take the lookup tools away rather than to ask the model
 * not to use them. Both blocks already say "you already have this"; the agent
 * spent a round trip re-fetching anyway, and an absent tool cannot be called.
 */
export function targetCanvasInContext(
	metadata: RunMetadata | undefined,
	task: Task | undefined,
	results: Record<string, SubAgentResult> | undefined,
): boolean {
	if (metadata?.contextBlock) return true;
	if (!task) return false;
	return !!resolveTarget(task, results, metadata?.projectInventory);
}

/**
 * Prefetches the canvas this task edits, when the run can name it without
 * asking the model.
 *
 * Returns undefined when there is no resolvable target, or when the target is
 * the canvas the user was already viewing — `metadata.contextBlock` holds that
 * one, and stating it twice only invites the agent to treat them as two canvases.
 */
export async function buildTargetCanvasContext(
	dbService: DbService | undefined,
	metadata: RunMetadata | undefined,
	task: Task | undefined,
	results: Record<string, SubAgentResult> | undefined,
): Promise<string | undefined> {
	const projectId = metadata?.projectId;
	if (!dbService || !projectId || !task) return undefined;

	const target = resolveTarget(task, results, metadata?.projectInventory);
	if (!target) return undefined;

	const location = metadata?.location;
	if (location?.where === target.where && location.id === target.id) {
		return undefined;
	}

	const block = await buildContextBlock(dbService, projectId, target, "target");
	if (block) return block;

	// Nothing came back, so the resource is planned but its artifact has not been
	// applied yet. Saying so is what stops the agent from hunting for a canvas
	// that does not exist — and from assuming an existing one is the target.
	logger.info("[TargetCanvas] Target is planned but not yet applied", target);
	const targetType = target.where === "route-canvas" ? "route" : "custom_block";
	return `## Target canvas
targetType: ${targetType}
targetId: ${target.id}
This ${targetType} is being created by this run and does not exist in the database yet, so its canvas is empty. Build its initial blocks. Do NOT call find_resource or get_route_details for it, and do NOT fall back to an unrelated existing canvas.`;
}
