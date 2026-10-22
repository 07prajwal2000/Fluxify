import { z } from "zod";
import { integrationGroupNameSchema } from "../schemas";

const decodeGroup = (val: string) => {
	try {
		return decodeURIComponent(val);
	} catch {
		return val;
	}
};

const groupSchema = z.string().transform(decodeGroup).pipe(integrationGroupNameSchema);

export const requestProjectParamSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
});

export const requestRouteSchema = z.object({
	projectId: z.uuidv7("Invalid projectId"),
	group: groupSchema,
});

export const requestQuerySchema = z.object({
	tags: z.string().optional(),
});

export const requestQueryWithGroupSchema = z.object({
	group: groupSchema,
	tags: z.string().optional(),
});

export const responseSchema = z.array(
	z.object({
		id: z.string(),
		name: z.string(),
		group: z.string(),
		variant: z.string(),
		config: z.object(),
		devConfig: z.object().nullable(),
		syncDev: z.boolean(),
		tags: z.array(z.string()).optional(),
		/** databases only: editor for custom conditions — SQL text or JS returning a filter */
		conditionEditor: z.enum(["sql", "js"]).optional(),
	}),
);
