/** the error, then what it wraps: blocks rethrow driver errors as their `cause` */
function* causes(error: unknown) {
	for (let e: any = error; e; e = e.cause) yield e;
}

/**
 * A deadlock, serialization failure or lock wait timeout: expected under
 * concurrency, and gone when the whole transaction runs again.
 */
export function isRetryableTransactionError(error: unknown): boolean {
	for (const e of causes(error)) {
		// Postgres SQLSTATE (Bun puts it on errno): deadlock, serialization failure
		if (e.errno === "40P01" || e.errno === "40001") return true;
		// MySQL: deadlock, lock wait timeout
		if (e.errno === 1213 || e.errno === 1205) return true;
		if (typeof e.hasErrorLabel === "function" && e.hasErrorLabel("TransientTransactionError"))
			return true;
	}
	return false;
}

export const MONGO_NO_REPLICA_SET =
	"MongoDB transactions need a replica set; this server is standalone, so transaction blocks on it will fail";

/** from the server's `hello` reply: a replica set member names its set, mongos says isdbgrid. Both run transactions */
export function standaloneWarning(hello: { setName?: string; msg?: string }) {
	return hello.setName || hello.msg === "isdbgrid" ? undefined : MONGO_NO_REPLICA_SET;
}

/**
 * A standalone mongod refuses any transaction with IllegalOperation (code 20).
 * With retryable writes on (the driver's default) the driver rethrows it as a
 * retryable-writes hint that has no code, keeping the server's on `originalError`.
 */
export function isTransactionUnsupported(error: unknown): boolean {
	const e = error as { code?: number; message?: string; originalError?: unknown } | null;
	if (e?.originalError) return isTransactionUnsupported(e.originalError);
	return e?.code === 20 && /Transaction numbers are only allowed/i.test(String(e.message));
}
