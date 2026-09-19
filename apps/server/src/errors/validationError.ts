import z from "zod";
import { baseErrorSchema, CustomError } from "./customError";

export class ValidationError extends CustomError {
	public readonly httpCode: number = 400;
	constructor(public readonly errors: { field: string; message: string }[]) {
		super({
			type: "validation",
			errors,
		});
	}
}

export const validationErrorSchema = baseErrorSchema.extend({
	type: z.literal("validation"),
	error: z.array(
		z.object({
			field: z.string(),
			message: z.string(),
		}),
	),
});
