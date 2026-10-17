import { assertCanReadAudit } from "../../../../../lib/edition";
import { existingProjectIds } from "../list/repository";
import { distinctActions, distinctResourceTypes, projectsWithEvents } from "./repository";

export default async function handleRequest() {
	assertCanReadAudit();
	const [resourceTypes, actions, projects] = await Promise.all([
		distinctResourceTypes(),
		distinctActions(),
		projectsWithEvents(),
	]);
	const existing = await existingProjectIds(projects.map((p) => p.id));
	return {
		resourceTypes,
		actions,
		projects: projects
			.map((p) => ({ ...p, deleted: !existing.has(p.id) }))
			.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
	};
}
