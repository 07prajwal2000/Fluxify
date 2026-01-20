import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";

export const logBlockSchema = z
  .object({
    message: z.string().optional().describe("string message to log"),
    level: z.enum(["info", "warn", "error"]).describe("log level"),
  })
  .extend(baseBlockDataSchema.shape);
