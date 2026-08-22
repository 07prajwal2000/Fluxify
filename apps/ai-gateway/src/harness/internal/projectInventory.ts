import type { ProjectInventoryEntry } from "../types";
import { fenceUntrusted } from "./untrusted";

/** Renders typed inventory at the two planning boundaries only. Do not append
 * this to the location context: builders and discussion agents do not need a
 * whole-project catalogue on every model call. */
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
