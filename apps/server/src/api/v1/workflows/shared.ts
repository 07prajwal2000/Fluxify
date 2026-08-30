import { z } from "zod";
import type { workflowsEntity } from "../../../db/schema";

/**
 * What every workflow action agrees on: the response shape and the row-to-JSON
 * mapping behind it.
 *
 * Zod and type-only imports only. The portal imports the action DTOs that build
 * on this, so a value import from `db/schema` here would drag drizzle into the
 * browser bundle.
 */

export const idParamSchema = z.object({ id: z.uuidv7() });

export const workflowSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	description: z.string().nullable(),
	active: z.boolean().nullable(),
	timeoutSeconds: z.number().int(),
	tracingEnabled: z.boolean(),
	recordExecution: z.boolean(),
	projectId: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/** Everything the API returns. `createdBy` is not part of it, so the list
 *  query need not select it. */
type Workflow = Omit<typeof workflowsEntity.$inferSelect, "createdBy">;

export function present(row: Workflow): z.infer<typeof workflowSchema> {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		active: row.active,
		timeoutSeconds: row.timeoutSeconds,
		tracingEnabled: row.tracingEnabled,
		recordExecution: row.recordExecution,
		projectId: row.projectId!,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
