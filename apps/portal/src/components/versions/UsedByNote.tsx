import { useState } from "react";
import { referencesQuery } from "@/query/referencesQuery";
import type { ReferenceSubjectKind } from "@/services/references";
import { ReferenceList } from "./ReferenceList";

/**
 * The promote dialog's change count (#740): how many production routes and
 * workflows a promote or rollback of this block or middleware will affect. The
 * count opens the same Used by list, so the person can see which ones.
 */
export function UsedByNote({
	kind,
	id,
	projectId,
}: {
	kind: ReferenceSubjectKind;
	id: string;
	projectId: string;
}) {
	const { data } = referencesQuery.useQuery(kind, id);
	const [open, setOpen] = useState(false);
	const references = data ?? [];
	const users = references.filter(
		(reference) =>
			reference.inProduction && (reference.kind === "route" || reference.kind === "workflow"),
	);
	if (users.length === 0) return null;
	const noun = users.length === 1 ? "route or workflow" : "routes and workflows";
	return (
		<div className="flex flex-col gap-1">
			<button
				type="button"
				className="w-fit text-left text-xs font-medium text-accent hover:underline"
				onClick={() => setOpen((current) => !current)}
			>
				{users.length} production {noun} will change
			</button>
			{open && <ReferenceList projectId={projectId} references={references} />}
		</div>
	);
}
