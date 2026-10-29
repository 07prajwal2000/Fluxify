import z from "zod";

export const requestBodySchema = z.object({
	projectId: z.uuidv7(),
	/** the file an export produced; checked in full by the service */
	bundle: z.record(z.string(), z.unknown()),
});

export const responseSchema = z.object({
	id: z.uuidv7(),
	/** what the import had to leave out or could not restore */
	warnings: z.array(z.string()),
});
