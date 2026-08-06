/**
 * Naming for the telemetry pipeline.
 *
 * A recorded run travels as one message so a trace is never stitched across
 * several — the whole run, or nothing. The project id sits in the subject so a
 * future consumer can filter by project without decoding every body.
 */

export const TRACE_STREAM = "FLUXIFY_TRACES";
export const TRACE_CONSUMER = "fluxify_telemetry";

const SUBJECT_ROOT = "fluxify.trace";
/** everything the telemetry worker consumes */
export const TRACE_SUBJECTS = `${SUBJECT_ROOT}.>`;

export const traceRunSubject = (projectId: string, runId: string) =>
	`${SUBJECT_ROOT}.${projectId}.${runId}`;

/** the project id segment of a trace subject */
export function subjectProjectId(subject: string): string | null {
	return subject.split(".")[2] ?? null;
}
