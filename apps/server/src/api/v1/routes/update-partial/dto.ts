import { z } from "zod";
import { ROUTE_REGEX } from "../constants";
import { CONTENT_TYPES } from "../../../../lib/routeConfig";

export const requestBodySchema = z.object({
  name: z.string().min(2).max(255).optional(),
  path: z
    .string()
    .min(1)
    .regex(ROUTE_REGEX, "Must be a valid URL path")
    .optional(),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE"], "Must be a HTTP Method")
    .optional(),
  active: z.boolean().optional(),
  // Validated in the service, not here: they are only meaningful against the
  // route's effective path, and a patch may not carry one.
  bodySchema: z.any().optional(),
  querySchema: z.any().optional(),
  paramsSchema: z.any().optional(),
  timeoutSeconds: z.number().int().min(30).optional(),
  tracingEnabled: z.boolean().optional(),
  recordExecution: z.boolean().optional(),
  acceptedContentTypes: z.array(z.enum(CONTENT_TYPES)).min(1).optional(),
});

export const requestRouteSchema = z.object({
  id: z.uuidv7(),
});

export const responseSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  method: z.string(),
	timeoutSeconds: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
