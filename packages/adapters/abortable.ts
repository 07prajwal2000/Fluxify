const NONE: ReadonlySet<PropertyKey> = new Set();

/**
 * `target` whose calls are refused once `signal` aborts, and whose pending
 * promises reject with its reason (#1000). `keep` names cleanup methods that
 * must still run after an abort (a rollback). No signal: `target` itself.
 *
 * ponytail: the driver's query is abandoned, not cancelled; it ends on the
 * pool's own statement timeout. Cancel per driver if that ever matters.
 */
export function abortable<T extends object>(
	target: T,
	signal: AbortSignal | undefined,
	keep: ReadonlySet<PropertyKey> = NONE,
): T {
	if (!signal) return target;
	return new Proxy(target, {
		get(t, key) {
			const value = Reflect.get(t, key);
			if (typeof value !== "function" || keep.has(key)) return value;
			return (...args: unknown[]) => {
				signal.throwIfAborted();
				const out = value.apply(t, args);
				return out instanceof Promise ? raceAbort(out, signal) : out;
			};
		},
	});
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
