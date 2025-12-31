import z from "zod";

export const requestParamSchema = z.object({ userId: z.string() });
export const responseSchema = z.string();
