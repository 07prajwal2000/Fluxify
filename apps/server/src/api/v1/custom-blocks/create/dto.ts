import z from "zod";

export const inputParamSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text_input"),
    name: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("checkbox"),
    name: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("array_editor"),
    name: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("integration_selector"),
    name: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string(),
    group: z.string(),
    variant: z.string().optional(),
    tags: z.array(z.string()).default([]),
    description: z.string().optional(),
  }),
  // The param carries an app config *key*, not the resolved value: `param:`
  // placeholders are substituted at compile time, so a resolved value would be
  // baked into the compiled worker source. The block reads `getConfig(params.x)`.
  z.object({
    type: z.literal("app_config_selector"),
    name: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("dropdown"),
    name: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string(),
    options: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      })
    ),
    description: z.string().optional(),
  }),
]);

import { premadeIconEnum } from "../shared";

export const baseRequestBodySchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string(),
  description: z.string().optional(),
  icon: z.enum(["premade-list", "custom"]).optional(),
  iconUrl: z.string().max(68266).optional(),
  projectId: z.string(),
  inputParams: z.array(inputParamSchema).optional(),
});

export const validatePremadeIcon = (data: any, ctx: z.RefinementCtx) => {
  if (data.icon === "premade-list") {
    const result = premadeIconEnum.safeParse(data.iconUrl);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["iconUrl"],
        message: "Invalid premade icon name",
      });
    }
  }
};

export const requestBodySchema = baseRequestBodySchema.superRefine(validatePremadeIcon);

export const responseSchema = z.object({
  id: z.string(),
});
