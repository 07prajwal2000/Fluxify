/** Recording and tracing, once per environment. Production's pair is the unprefixed one. */
export type Observability = {
	devRecordExecution: boolean;
	devTracingEnabled: boolean;
	recordExecution: boolean;
	tracingEnabled: boolean;
};

/** Only the switches that moved, so an untouched production recording is not warned about again. */
export function changedObservability(before: Observability, after: Observability) {
	const changed: Partial<Observability> = {};
	for (const key of Object.keys(after) as (keyof Observability)[]) {
		if (after[key] !== before[key]) changed[key] = after[key];
	}
	return changed;
}
