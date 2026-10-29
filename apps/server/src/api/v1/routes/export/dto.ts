import z from "zod";
import { routeBundleSchema } from "../../../../modules/routeTransfer/bundle";

export const requestRouteSchema = z.object({ id: z.uuidv7() });

export const requestQuerySchema = z.object({
	/** leave the route's test suites out of the file with `false` */
	includeTests: z
		.enum(["true", "false"])
		.default("true")
		.transform((v) => v === "true"),
});

export const responseSchema = routeBundleSchema;
