import { z } from "zod";
import { canvasChangesSchema } from "../../../../modules/canvas/types";

export const requestRouteSchema = z.object({
  id: z.uuidv7(),
});

/** one canvas contract, shared with custom blocks — see modules/canvas/types */
export const requestBodySchema = canvasChangesSchema;
