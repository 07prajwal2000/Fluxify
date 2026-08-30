import { z } from "zod";
import { idParamSchema } from "../shared";

export const requestParamSchema = idParamSchema;

/**
 * A test run's payload. Anything JSON is accepted as-is; a string is accepted
 * too, so a workflow triggered by plain text has something to receive. Binary
 * is the caller's to encode — send base64 or hex with a media type describing
 * it, the same way an image travels through JSON anywhere else.
 */
export const requestBodySchema = z.object({
	payload: z.unknown().optional(),
});

export const responseSchema = z.object({
	/** The job id, so the run can be correlated in logs and traces. */
	id: z.string(),
	accepted: z.literal(true),
});
