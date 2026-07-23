import z from "zod";
import { instanceSettingItemSchema } from "../dto";
import { instanceSettingCategorySchema } from "../../../../lib/instance-settings/schemas";

export const requestRouteSchema = z.object({
	category: instanceSettingCategorySchema,
});

export const responseSchema = z.array(instanceSettingItemSchema);
