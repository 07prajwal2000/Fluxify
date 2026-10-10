import { z } from "zod";
import { appConfigDataTypeEnum } from "../../../../db/schema";

export const requestRouteSchema = z.object({
	projectId: z.string(),
	id: z.coerce.number().min(1).int(),
});

export const responseSchema = z.object({
	id: z.number(),
	keyName: z.string(),
	description: z.string(),
	value: z.string(),
	/** development's own value, masked like `value`; null while it has none */
	devValue: z.string().nullable(),
	/** development reads `value` instead of `devValue` */
	syncDev: z.boolean(),
	isEncrypted: z.boolean(),
	dataType: z.enum(appConfigDataTypeEnum.enumValues),
	encodingType: z.enum(["plaintext", "base64", "hex"]),
	createdAt: z.string(),
	updatedAt: z.string(),
});
