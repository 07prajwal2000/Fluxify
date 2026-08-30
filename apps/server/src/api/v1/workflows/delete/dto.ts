import { z } from "zod";
import { idParamSchema } from "../shared";

export const requestParamSchema = idParamSchema;
export const responseSchema = z.object({ id: z.uuidv7() });
