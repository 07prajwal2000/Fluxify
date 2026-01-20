import { z } from "zod";
import { appConfigDataTypeEnum } from "../../../../db/schema";

export const requestBodySchema = z.object({
  keyName: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9_]+$/)
    .describe(
      "Key name must be at least 3 characters long and can only contain letters, numbers, and underscores"
    ),
  description: z.string().max(255),
  value: z
    .string()
    .or(z.boolean())
    .or(z.number())
    .transform((val) => val.toString()),
  dataType: z
    .enum(appConfigDataTypeEnum.enumValues)
    .optional()
    .default("string"),
  isEncrypted: z.boolean(),
  encodingType: z.enum(["plaintext", "base64", "hex"]),
});
export const responseSchema = z.object({
  id: z.number(),
});
