import z from "zod";

export const paginationRequestQuerySchema = z.object({
	page: z.coerce.number().min(1).default(1).describe("page requested"),
	perPage: z.coerce.number().min(5).max(50).default(10).describe("how many records per page"),
});

export const paginationResponseSchema = z.object({
	page: z.coerce.number().describe("current page"),
	totalPages: z.coerce.number().describe("total number of pages"),
	hasNext: z.coerce.boolean().describe("bool value gives if any pages are available"),
});
