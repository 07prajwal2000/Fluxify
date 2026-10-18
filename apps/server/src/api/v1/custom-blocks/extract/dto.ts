import { z } from "zod";
import { canvasParentTypeSchema } from "../../../../modules/canvas/types";

export const requestBodySchema = z.object({
	projectId: z.string(),
	source: z.object({
		kind: canvasParentTypeSchema,
		id: z.string(),
	}),
	/** block keys (`response_1`) on the source canvas, as get_canvas shows them */
	keys: z.array(z.string()).min(1, "Select at least one block to extract."),
	name: z
		.string()
		.min(1)
		.regex(/^[a-z0-9_]+$/),
	label: z.string().min(1),
	/** swap the selection on the source canvas for the new custom block */
	replace: z.boolean().default(false),
});

export const responseSchema = z.object({
	id: z.string(),
	/** the stored block name, the type an instance of it carries */
	name: z.string(),
	/** key of the instance that replaced the selection; only when `replace` was set */
	instanceKey: z.string().optional(),
});
