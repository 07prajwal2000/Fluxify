import { z } from "zod";
import {
  paginationRequestQuerySchema,
  paginationResponseSchema,
} from "../../../../lib/pagination";
import { appConfigDataTypeEnum } from "../../../../db/schema";

export const requestQuerySchema = paginationRequestQuerySchema.extend({
  search: z.string().optional(),
  sort: z.enum(["asc", "desc"]).optional(),
  sortBy: z
    .enum([
      "id",
      "keyName",
      "createdAt",
      "updatedAt",
      "isEncrypted",
      "encodingType",
      "createdAt",
      "updatedAt",
    ])
    .optional(),
});

export const responseSchema = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      keyName: z.string(),
      isEncrypted: z.boolean(),
      encodingType: z.enum(["plaintext", "base64", "hex"]),
      dataType: z.enum(appConfigDataTypeEnum.enumValues),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
  pagination: paginationResponseSchema,
});

// id: number;
// keyName: string;
// description: string;
// value: string;
// isEncrypted: boolean;
// encodingType: string;
// createdAt: string;
// updatedAt: string;
