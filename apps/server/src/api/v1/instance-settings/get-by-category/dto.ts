import z from "zod";
import { instanceSettingCategorySchema } from "../../../../lib/instance-settings/schemas";
import { instanceSettingItemSchema } from "../dto";

export const requestRouteSchema = z.object({
	category: instanceSettingCategorySchema,
});

export const responseSchema = z.array(instanceSettingItemSchema);
