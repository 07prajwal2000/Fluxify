import z from "zod";
import { ROUTE_REGEX } from "../constants";
import { routeSchemaValidationRefinement } from "../schema-validator";
import { CONTENT_TYPES } from "../../../../lib/routeConfig";

export const requestBodySchema = z.object({
  name: z.string().min(2).max(255),
  path: z.string().min(1).regex(ROUTE_REGEX, "Must be a valid URL path"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"], "Must be a HTTP Method"),
  projectId: z.string().refine((v) => {
    return z.uuidv7().safeParse(v).success;
  }),
  bodySchema: z.any().optional(),
  querySchema: z.any().optional(),
  paramsSchema: z.any().optional(),
  timeoutSeconds: z.number().int().min(30).default(30),
  active: z.boolean().optional(),
  tracingEnabled: z.boolean().optional(),
  acceptedContentTypes: z.array(z.enum(CONTENT_TYPES)).min(1).optional(),
}).superRefine(routeSchemaValidationRefinement);

export const responseSchema = z.object({
  id: z.uuidv7(),
});
