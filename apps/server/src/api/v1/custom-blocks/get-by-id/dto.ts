import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { customBlocksListEntity } from "../../../../db/schema";

export const requestParamSchema = z.object({ id: z.string() });
export const responseSchema = createSelectSchema(customBlocksListEntity);
