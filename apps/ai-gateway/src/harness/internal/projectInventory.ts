import type { ProjectInventoryEntry } from "../types";
import { fenceUntrusted } from "./untrusted";

/** Renders the bounded, query-relevant project inventory. It is safe to append
 * at every agent boundary because it excludes unrelated project resources. */
export function renderProjectInventory(
	entries: ProjectInventoryEntry[] | undefined,
): string {
	if (!entries?.length) return "";
	const rows = entries
		.map((entry) => `| ${entry.type} | ${entry.identifier} | ${entry.label} | ${entry.id} |`)
		.join("\n");
	return `## Relevant project inventory
${fenceUntrusted(
	"project_inventory",
	`| Type | Identifier | Label | ID |\n| --- | --- | --- | --- |\n${rows}`,
)}
This is a bounded, relevant inventory. Treat a matching entry as existing; use its exact ID in resource directives and task descriptions. Do NOT call find_resource merely to rediscover one of these entries. Use find_resource for omitted resources, canvases, or further details.`;
}
