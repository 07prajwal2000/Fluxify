import { Spinner } from "@fluxify/components";
import { referencesQuery } from "@/query/referencesQuery";
import type { ReferenceSubjectKind } from "@/services/references";
import { ReferenceList, UsedByEmpty } from "./ReferenceList";

/**
 * Everything that uses a custom block or middleware (#740): routes, workflows,
 * other blocks, middlewares and test suite hooks. Sandboxes are never listed.
 */
export function UsedBy({
	kind,
	id,
	projectId,
}: {
	kind: ReferenceSubjectKind;
	id: string;
	projectId: string;
}) {
	const { data, isLoading } = referencesQuery.useQuery(kind, id);
	if (isLoading) return <Spinner size="sm" />;
	const references = data ?? [];
	if (references.length === 0) return <UsedByEmpty />;
	return <ReferenceList projectId={projectId} references={references} />;
}
