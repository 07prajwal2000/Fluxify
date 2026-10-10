import { z } from "zod";

export const requestRouteSchema = z.object({
	projectId: z.string(),
	id: z.coerce.number().min(1),
});

export const requestBodySchema = z.object({
	keyName: z.string(),
	description: z.string(),
	value: z.string().or(z.boolean()).or(z.number()).optional(),
	/** omit to keep the current one, null to remove it */
	devValue: z.string().or(z.boolean()).or(z.number()).nullish(),
	syncDev: z.boolean().optional(),
	isEncrypted: z.boolean(),
	encodingType: z.enum(["plaintext", "base64", "hex"]),
});

export const responseSchema = z.object({
	id: z.number(),
	keyName: z.string(),
	description: z.string(),
	value: z.string(),
	devValue: z.string().nullable(),
	syncDev: z.boolean(),
	isEncrypted: z.boolean(),
	encodingType: z.enum(["plaintext", "base64", "hex"]),
	createdAt: z.string(),
	updatedAt: z.string(),
});
