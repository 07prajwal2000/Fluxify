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
export const compileWorkflowSubject = (workflowId: string) =>
	`${SUBJECT_ROOT}.workflow.${workflowId}`;
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
export const workflowKey = (projectId: string, workflowId: string) =>
	`workflow.${projectId}.${workflowId}`;
export const projectConfigKey = (projectId: string) =>
	`project-config.${projectId}.current`;

/**
 * The filters a worker watches for its project. `kinds` narrows them to what
 * its mode actually runs — a workflow-only worker holds no HTTP route table,
 * so there is no reason to ship it every route in the project.
 */
export const projectArtifactFilters = (
	projectId: string,
	kinds: readonly string[] = ARTIFACT_KINDS,
) => kinds.map((kind) => `${kind}.${projectId}.*`);

const ARTIFACT_KINDS = [
	"route",
	"custom-block",
	"workflow",
	"project-config",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export function artifactKind(key: string): ArtifactKind | null {
	const kind = key.split(".")[0] as ArtifactKind;
	return ARTIFACT_KINDS.includes(kind) ? kind : null;
}

/** the id segment of an artifact key */
export function artifactId(key: string) {
	return key.split(".").slice(2).join(".");
}
