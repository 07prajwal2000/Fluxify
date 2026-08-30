import { z } from "zod";
import {
	paginationRequestQuerySchema,
	paginationResponseSchema,
} from "../../../../lib/pagination";
import { workflowSchema } from "../shared";

export const requestQuerySchema = z
	.clone(paginationRequestQuerySchema)
	.extend({
		projectId: z.uuidv7().optional(),
		search: z.string().optional(),
		active: z.enum(["true", "false"]).optional(),
	})
	.transform((q) => ({
		page: q.page,
		perPage: q.perPage,
		projectId: q.projectId,
		search: q.search,
		active: q.active === undefined ? undefined : q.active === "true",
	}));

export const responseSchema = z.object({
	data: z.array(workflowSchema.extend({ projectName: z.string() })),
	pagination: paginationResponseSchema,
});
