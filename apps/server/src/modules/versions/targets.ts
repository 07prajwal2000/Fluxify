import {
	CHAN_ON_CUSTOM_BLOCK_CHANGE,
	CHAN_ON_ROUTE_CHANGE,
	CHAN_ON_WORKFLOW_CHANGE,
	publishMessage,
} from "../../db/redis";
import type { CanvasVersionKind } from "../../db/schema";
import { requestMiddlewareCompile } from "../compiler/publisher";

/**
 * What versions and deployments need to know about each kind of target (#738,
 * #739, #740): how to name a missing one, and how to tell the compiler its
 * working copy or its promoted version moved.
 */

export const NOT_FOUND = {
	route: "Route not found",
	workflow: "Workflow not found",
	custom_block: "Custom block not found",
	middleware: "Middleware not found",
} as const satisfies Record<CanvasVersionKind, string>;

/** Words for messages: "this route", "a custom block". */
export const NOUN = {
	route: "route",
	workflow: "workflow",
	custom_block: "custom block",
	middleware: "middleware",
} as const satisfies Record<CanvasVersionKind, string>;

/**
 * The usual change signal, so the compiler rebuilds what the target now serves:
 * development after a checkout, production after a promote or rollback. A
 * middleware has its own artifact and its own request, so no route recompiles.
 */
export async function announceChange(kind: CanvasVersionKind, id: string, projectId: string) {
	if (kind === "route") return await publishMessage(CHAN_ON_ROUTE_CHANGE, id);
	if (kind === "workflow") return await publishMessage(CHAN_ON_WORKFLOW_CHANGE, id);
	if (kind === "custom_block") return await publishMessage(CHAN_ON_CUSTOM_BLOCK_CHANGE, id);
	return await requestMiddlewareCompile(id, projectId, "middleware version changed");
}
