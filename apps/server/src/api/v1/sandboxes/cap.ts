/**
 * How many persistent sandboxes one user may keep in one project (#763). The
 * count is read at call time, so a test or a reloaded process sees the current
 * value; an unset or unreadable one falls back to the default rather than
 * stopping the process.
 */
export function maxSandboxesPerUser() {
	const value = Number(process.env.MAX_SANDBOX_PER_USER);
	return Number.isInteger(value) && value > 0 ? value : 20;
}
