import { z } from "zod";
import { canvasItemsSchema } from "../../../../modules/canvas/types";

export const requestRouteSchema = z.object({
	id: z.uuidv7(),
});

export type XYPosition = {
	x: number;
	y: number;
};

/** one canvas read contract, shared by every canvas kind — see modules/canvas/types */
export const responseSchema = canvasItemsSchema;
