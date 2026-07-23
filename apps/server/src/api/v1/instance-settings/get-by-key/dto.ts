import z from "zod";
import { instanceSettingItemSchema } from "../dto";

export const requestRouteSchema = z.object({
	key: z.string(),
});

export const responseSchema = instanceSettingItemSchema;
