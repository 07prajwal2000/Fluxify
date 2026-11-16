/**
 * Which settings tab is open, given `?tab=`. Tabs a viewer must not see are
 * only known once the session has loaded, so until then any real tab is
 * accepted: judging it against the partial list would send a refresh on
 * Backup back to General. Once `authReady`, only a visible tab stands.
 */
export function resolveActiveTab<T extends string>({
	requested,
	visible,
	all,
	authReady,
	fallback,
}: {
	requested: string | undefined;
	visible: readonly T[];
	all: readonly T[];
	authReady: boolean;
	fallback: T;
}): T {
	const pool = authReady ? visible : all;
	return pool.find((id) => id === requested) ?? fallback;
}
