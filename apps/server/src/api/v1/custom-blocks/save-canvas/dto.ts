import { z } from "zod";
import { canvasChangesSchema } from "../../../../modules/canvas/types";

export const requestParamSchema = z.object({
  id: z.string(),
});

/** one canvas contract, shared with routes — see modules/canvas/types */
export const requestBodySchema = canvasChangesSchema;
