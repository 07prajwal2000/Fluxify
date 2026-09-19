import z from "zod";

export const baseErrorSchema = z.object({
	type: z.enum(["regular", "validation", "auth"]),
});

export const errorSchema = baseErrorSchema.extend({
	error: z.string(),
});

type CustomErrorType =
	| {
			type: "regular";
			message: string;
	  }
	| {
			type: "validation";
			errors: {
				field: string;
				message: string;
			}[];
	  }
	| {
			type: "auth";
			message: string;
	  };

export abstract class CustomError extends Error {
	public abstract readonly httpCode: number;
	constructor(private readonly data: CustomErrorType) {
		super(data.type == "validation" ? "Validation Error" : data.message);
	}
	getError() {
		return this.data;
	}
}
