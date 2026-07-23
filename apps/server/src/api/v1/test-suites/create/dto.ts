import { testSuiteCoreSchema } from "../schema";
import { z } from "zod";

export const requestBodySchema = z.object({
	name: z.string().describe("Name of the test suite"),
	description: z.string().describe("Description of the test suite"),
});

export const responseSchema = z.object({
	id: z.string(),
});
