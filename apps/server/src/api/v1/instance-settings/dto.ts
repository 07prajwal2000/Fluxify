import z from "zod";
import { instanceSettingCategorySchema } from "../../../lib/instance-settings/schemas";

export const instanceSettingItemSchema = z.object({
	id: z.string(),
	key: z.string(),
	category: instanceSettingCategorySchema,
	value: z.record(z.string(), z.unknown()),
	isPublic: z.boolean(),
	createdAt: z.date().or(z.string()),
	updatedAt: z.date().or(z.string()),
});

export type InstanceSettingItem = z.infer<typeof instanceSettingItemSchema>;
