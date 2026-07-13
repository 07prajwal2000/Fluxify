import { z } from "zod";

export const premadeIconEnum = z.enum([
  "database",
  "api",
  "robot",
  "tool",
  "user",
  "lock",
  "mail",
  "calendar",
  "file",
  "folder",
  "chart",
  "image",
  "code",
]);

export type PremadeIconType = z.infer<typeof premadeIconEnum>;
