import { DbService } from "../../../harness/internal/dbService";

/** Stateless — the same instance the harness tools use. */
const dbService = new DbService();

/**
 * One free-text box over every project resource the user can reference. Each
 * lookup is a prefix full-text match against that table's GIN-indexed columns and
 * caps itself at 10 rows, so the response stays bounded at 30.
 *
 * The whole phrase goes in as one term and its words are ANDed, which is what a
 * search box should do — "get users" shouldn't return every route with "get".
 */
export default async function handleRequest(projectId: string, q: string) {
	const [routes, integrations, appConfigs] = await Promise.all([
		dbService.findRoutes(projectId, q),
		dbService.findIntegrations(projectId, q),
		dbService.findAppConfigs(projectId, q),
	]);

	return { query: q, results: [...routes, ...integrations, ...appConfigs] };
}
