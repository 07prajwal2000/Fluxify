import z from "zod";
import { ROUTE_REGEX } from "../constants";

export const requestBodySchema = z.object({
  name: z.string().min(2).max(255),
  path: z.string().min(1).regex(ROUTE_REGEX, "Must be a valid URL path"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"], "Must be a HTTP Method"),
  projectId: z.string().refine((v) => {
    return z.uuidv7().safeParse(v).success;
  }),
});

export const responseSchema = z.object({
  id: z.uuidv7(),
});
