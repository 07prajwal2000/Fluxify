import { z } from "zod";

export const paramSchema = z.object({ projectId: z.string() });

export const responseSchema = z.array(
	z.object({
		id: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		targetType: z.enum(["route", "workflow"]),
		targetId: z.string(),
		targetName: z.string().nullable(),
	}),
);
