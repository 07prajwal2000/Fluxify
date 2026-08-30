import { canvasChangesSchema } from "../../../../modules/canvas/types";
import { idParamSchema } from "../shared";

export const requestParamSchema = idParamSchema;

/** one canvas contract, shared with routes — see modules/canvas/types */
export const requestBodySchema = canvasChangesSchema;
