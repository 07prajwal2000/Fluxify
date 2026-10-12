import { useQuery } from "@tanstack/react-query";
import { type ReferenceSubjectKind, referencesService } from "@/services/references";
import { KIND_SEGMENT } from "@/services/versions";

/**
 * Who uses a custom block or middleware (#740). One finder on the server, so
 * the list here and the delete guard never disagree, and sandboxes are absent.
 */
export const referencesQuery = {
	useQuery(kind: ReferenceSubjectKind, id: string) {
		return useQuery({
			queryKey: [KIND_SEGMENT[kind], id, "references"],
			queryFn: () => referencesService.list(kind, id),
			enabled: Boolean(id),
			refetchOnWindowFocus: false,
		});
	},
};
