/** The default when the setting is unset, unreadable or out of range. */
const DEFAULT_MAX_SANDBOX_PER_USER = 20;
/** The most the setting will accept; a larger value falls back to the default. */
const MAX_SANDBOX_PER_USER_CEILING = 1000;

/**
 * How many persistent sandboxes one user may keep in one project (#763). The
 * count is read at call time, so a test or a reloaded process sees the current
 * value. Only an integer between 1 and 1000 is used; unset, unreadable or
 * out-of-range values fall back to the default (20) rather than stopping the
 * process or leaving the cap unbounded.
 */
export function maxSandboxesPerUser() {
	const value = Number(process.env.MAX_SANDBOX_PER_USER);
	return Number.isInteger(value) && value >= 1 && value <= MAX_SANDBOX_PER_USER_CEILING
		? value
		: DEFAULT_MAX_SANDBOX_PER_USER;
}
