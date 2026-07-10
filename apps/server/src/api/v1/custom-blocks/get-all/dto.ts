import z from "zod";

export const requestQuerySchema = z.object({
  projectId: z.string(),
});

export const responseSchema = z.array(
  z.object({
    id: z.string(),
    label: z.string(),
    name: z.string(),
    description: z.string().optional().nullable(),
    icon: z.string().optional().nullable(),
    iconUrl: z.string().optional().nullable(),
    inputParams: z.any().optional().nullable(),
    sourceType: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
  })
);
