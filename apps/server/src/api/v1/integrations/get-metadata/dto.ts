import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
	integrationId: z.uuidv7(),
});

export const columnSchema = z.object({
	name: z.string(),
	type: z.string(),
	/** table that owns the column — the referenced table for a foreign key, else the column's own table */
	owner: z.string(),
});

export const tableSchema = z.object({
	table: z.string(),
	columns: z.array(columnSchema),
});

export const responseSchema = z.object({
	id: z.string(),
	name: z.string(),
	group: z.string(),
	variant: z.string(),
	metadata: z.object({
		tables: z.array(tableSchema),
	}),
});
