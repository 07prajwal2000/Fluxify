import { z } from "zod";
import { testSuiteCoreSchema } from "../schema";

export const requestBodySchema = z.object({
	name: z.string().describe("Name of the test suite"),
	description: z.string().describe("Description of the test suite"),
});

export const responseSchema = z.object({
	id: z.string(),
});
