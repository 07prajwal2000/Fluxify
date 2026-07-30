/**
 * Naming for the compile pipeline.
 *
 * Requests travel on a JetStream work queue so a compile survives an admin
 * restart and is handled exactly once. Results are written to the artifact KV
 * bucket, and workers watch their own project's key prefix — the KV update is
 * itself the fan-out, so there is no second "please reload" subject to keep in
 * sync with the data.
 */

export const COMPILE_STREAM = "FLUXIFY_COMPILE";
export const COMPILE_CONSUMER = "fluxify_compiler";

const SUBJECT_ROOT = "fluxify.compile";
/** everything the compiler consumes */
export const COMPILE_SUBJECTS = `${SUBJECT_ROOT}.>`;

/**
 * Route and custom block requests carry only the id — the compiler resolves the
 * project from the database, so a caller reacting to a change signal does not
 * have to know it.
 */
export const compileRouteSubject = (routeId: string) =>
	`${SUBJECT_ROOT}.route.${routeId}`;
export const compileCustomBlockSubject = (id: string) =>
	`${SUBJECT_ROOT}.custom-block.${id}`;
/** `all` republishes config for every project */
export const compileProjectConfigSubject = (projectId: string) =>
	`${SUBJECT_ROOT}.project-config.${projectId}`;
export const compileProjectSubject = (projectId: string) =>
	`${SUBJECT_ROOT}.project.${projectId}`;
export const ALL_PROJECTS = "all";

/* ---------------------------------------------------------------- KV keys */
/**
 * Keys are `<kind>.<projectId>.<id>` so a worker can watch `*.<projectId>.*`
 * style filters and receive nothing belonging to another project. Ids are used
 * rather than names — KV keys only allow `-/_=.` plus alphanumerics, and a
 * custom block's display name has no such restriction.
 */
export const routeKey = (projectId: string, routeId: string) =>
	`route.${projectId}.${routeId}`;
export const customBlockKey = (projectId: string, id: string) =>
	`custom-block.${projectId}.${id}`;
export const projectConfigKey = (projectId: string) =>
	`project-config.${projectId}.current`;

/** the three filters a worker watches for its project */
export const projectArtifactFilters = (projectId: string) => [
	`route.${projectId}.*`,
	`custom-block.${projectId}.*`,
	`project-config.${projectId}.*`,
];

export type ArtifactKind = "route" | "custom-block" | "project-config";

export function artifactKind(key: string): ArtifactKind | null {
	const kind = key.split(".")[0];
	return kind === "route" || kind === "custom-block" || kind === "project-config"
		? kind
		: null;
}

/** the id segment of an artifact key */
export function artifactId(key: string) {
	return key.split(".").slice(2).join(".");
}
