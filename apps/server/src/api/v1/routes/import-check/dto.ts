import z from "zod";

export const requestBodySchema = z.object({
	projectId: z.uuidv7(),
	name: z.string(),
	path: z.string(),
	method: z.enum(["GET", "POST", "PUT", "DELETE"]),
});

export const responseSchema = z.object({
	/** a route with this name is already in the project */
	nameTaken: z.boolean(),
	/** a route in the project already answers this method and path */
	pathTaken: z.boolean(),
});
