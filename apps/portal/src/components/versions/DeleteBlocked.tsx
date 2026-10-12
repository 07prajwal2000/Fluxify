import type { Reference } from "@/services/references";
import { ReferenceList } from "./ReferenceList";

/**
 * The error state of a delete that the server refused (#740): the message, and
 * the same rows "Used by" shows, so the person can see who still uses it and go
 * remove it there. Rendered inside the confirm dialog, so it stays open.
 */
export function DeleteBlocked({
	message,
	references,
	projectId,
}: {
	message: string;
	references: Reference[];
	projectId: string;
}) {
	return (
		<div className="mt-3 flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3">
			<p className="text-xs text-danger">{message}</p>
			<ReferenceList projectId={projectId} references={references} />
		</div>
	);
}
