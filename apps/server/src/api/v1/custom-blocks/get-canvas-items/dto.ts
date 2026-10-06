import { z } from "zod";
import { canvasItemsSchema } from "../../../../modules/canvas/types";

export const requestParamSchema = z.object({
	id: z.string(),
});

/** one canvas read contract, shared by every canvas kind — see modules/canvas/types */
export const responseSchema = canvasItemsSchema;
