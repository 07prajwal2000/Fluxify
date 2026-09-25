import type { Context } from "hono";
import type z from "zod";
import type { validationErrorSchema } from "../errors/validationError";

export default function (error: any, ctx: Context) {
	if (!error?.success) {
		const body: z.infer<typeof validationErrorSchema> = {
			type: "validation",
			errors: (error?.error?.issues ?? []).map((err: any) => ({
				// full path ("changes.blocks.3.data"); empty for a root-level issue
				field: (err.path ?? []).join("."),
				message: err.message,
			})),
		};
		return ctx.json(body, 400);
	}
}
