/**
 * Versioning (#738), the parts that need no database: whether the working copy
 * has moved past its last version, and whether a settings save changed
 * something a version keeps.
 */

/** `committedRevision` is null until the first commit or checkout. */
export function hasUncommitted(row: { canvasRevision: number; committedRevision: number | null }) {
	return row.committedRevision === null || row.canvasRevision !== row.committedRevision;
}

/** The settings a version keeps (see `CanvasSnapshot`); the rest stay live. */
export const ROUTE_VERSIONED_FIELDS = [
	"path",
	"method",
	"bodySchema",
	"querySchema",
	"paramsSchema",
	"timeoutSeconds",
] as const;
export const WORKFLOW_VERSIONED_FIELDS = ["timeoutSeconds"] as const;

/**
 * Whether saving `incoming` over `stored` changes a versioned setting. A field
 * the save leaves out is untouched, and a missing value equals null — so a form
 * that sends every field back changes nothing unless a versioned value moved.
 * Schemas compare as JSON, whatever order their keys arrive in.
 */
export function versionedSettingsChanged(
	stored: Record<string, unknown>,
	incoming: Record<string, unknown>,
	fields: readonly string[],
) {
	return fields.some(
		(field) =>
			incoming[field] !== undefined &&
			!Bun.deepEquals(incoming[field] ?? null, stored[field] ?? null),
	);
}
