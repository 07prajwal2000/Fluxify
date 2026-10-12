import type {
	referencesConflictSchema,
	referencesResponseSchema,
} from "@fluxify/server/src/modules/references/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";
import { KIND_SEGMENT, type VersionKind } from "./versions";

export type Reference = z.infer<typeof referencesResponseSchema>["references"][number];
export type ReferenceKind = Reference["kind"];

/** The subjects that expose a references list: the shared, versioned kinds (#740). */
export type ReferenceSubjectKind = Extract<VersionKind, "custom_block" | "middleware">;

type ReferencesConflict = z.infer<typeof referencesConflictSchema>;

/** Everything that uses a custom block or middleware. Sandboxes are never listed. */
export const referencesService = {
	async list(kind: ReferenceSubjectKind, id: string): Promise<Reference[]> {
		const result = await httpClient.get(`/v1/${KIND_SEGMENT[kind]}/${id}/references`);
		return (result.data as z.infer<typeof referencesResponseSchema>).references;
	},
};

/**
 * The 409 body of a refused delete carries the same list as the endpoint (#740).
 * The delete flows render it instead of a bare toast, so the person sees who
 * still uses the block and can go remove it there.
 */
export function referencesFromDeleteError(
	error: unknown,
): { message: string; references: Reference[] } | undefined {
	const response = (error as { response?: { data?: unknown } } | undefined)?.response;
	const data = response?.data as Partial<ReferencesConflict> | undefined;
	if (!data || !Array.isArray(data.references)) return undefined;
	return {
		message: typeof data.message === "string" ? data.message : "Still in use",
		references: data.references,
	};
}
