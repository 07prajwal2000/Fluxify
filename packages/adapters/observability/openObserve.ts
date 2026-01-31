import z from "zod";

export const openObserveSettings = z.object({
  baseUrl: z.url(), // e.g. http://localhost:5080/api/<ORG_ID>
  credentials: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
  encodedBasicAuth: z.string().optional(),
  projectId: z.uuidv7(),
  routeId: z.uuidv7(),
});
