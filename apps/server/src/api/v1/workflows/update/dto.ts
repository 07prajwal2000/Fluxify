import { requestBodySchema as createRequestBodySchema } from "../create/dto";
import { idParamSchema, workflowSchema } from "../shared";

export const requestParamSchema = idParamSchema;

/** Every creatable field except the project — a workflow does not move. */
export const requestBodySchema = createRequestBodySchema
	.omit({ projectId: true })
	.partial();

export const responseSchema = workflowSchema;
