import z from "zod";
import { instanceSettingCategorySchema } from "../../../../lib/instance-settings/schemas";
import { instanceSettingItemSchema } from "../dto";

export const requestBodySchema = z.object({
	key: z.string(),
	value: z.record(z.string(), z.unknown()),
	category: instanceSettingCategorySchema.optional(),
	isPublic: z.boolean().optional(),
});

export const responseSchema = z.object({
	message: z.string(),
	data: instanceSettingItemSchema,
});
