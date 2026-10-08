import { ConflictError } from "../../../errors/conflictError";
import type { RouteConflict } from "./update/repository";

/**
 * Says exactly which rule a clash broke (#672). "name or path already exist"
 * read as a path clash, so an agent gave up on GET /users/:id next to
 * PUT /users/:id when only the name was taken.
 */
export function routeConflictError(
	clash: RouteConflict,
	wanted: { projectId: string; name: string; path: string; method: string },
) {
	if (clash.projectId === wanted.projectId && clash.name === wanted.name) {
		return new ConflictError(
			`A route named "${wanted.name}" already exists in this project (${clash.method} ${clash.path}). Route names are unique per project; pick another name.`,
		);
	}
	const owner =
		clash.projectId === wanted.projectId
			? `route "${clash.name}"`
			: "a route in another project (projects without a subdomain share one URL space)";
	const why =
		clash.path === wanted.path
			? ""
			: ` ${wanted.path} and ${clash.path} match the same requests: the router ignores param names.`;
	return new ConflictError(
		`${wanted.method} ${clash.path} is already taken by ${owner}.${why} Other methods on the same path are allowed.`,
	);
}
