import z from "zod";
import { instanceSettingItemSchema } from "../dto";

export const responseSchema = z.array(instanceSettingItemSchema);
