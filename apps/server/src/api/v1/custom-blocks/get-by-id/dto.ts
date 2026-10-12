import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { customBlocksListEntity } from "../../../../db/schema";

export const requestParamSchema = z.object({ id: z.string() });
export const responseSchema = createSelectSchema(customBlocksListEntity).extend({
	/** the number of the version the working copy came from; null before the first (#740) */
	headVersionNumber: z.number().int().nullable(),
	/** the version production runs; null until one is promoted */
	prodVersionNumber: z.number().int().nullable(),
	/** the working copy has changes no version holds */
	uncommitted: z.boolean(),
});
