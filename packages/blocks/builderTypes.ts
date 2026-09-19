import z from "zod";

export const blockDTOSchema = z.object({
	id: z.uuidv7(),
	type: z.string(),
	data: z.any(),
	position: z.object({
		x: z.number(),
		y: z.number(),
	}),
});

export const blocksListDTOSchema = z.array(blockDTOSchema);

export const edgeDTOSchema = z.array(
	z.object({
		id: z.uuidv7(),
		from: z.string(),
		to: z.string(),
		fromHandle: z.string(),
		toHandle: z.string(),
	}),
);

export type BlockDTOType = z.infer<typeof blockDTOSchema>;
export type BlocksListDTOSchemaType = z.infer<typeof blocksListDTOSchema>;
export type EdgeDTOSchemaType = z.infer<typeof edgeDTOSchema>;

export type EdgesType = Record<
	string,
	{
		to: string;
		handle: string;
	}[]
>;
