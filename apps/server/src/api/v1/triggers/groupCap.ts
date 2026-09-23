/**
 * Every trigger in a group has its own queue, and whatever scales a worker on
 * backlog polls each of those queues on a schedule. The cap keeps that bounded.
 *
 * Only adding to a group is refused. A group already over the cap (from before
 * it existed, or a lowered setting) still saves and runs; it just cannot grow.
 */
export function maxTriggersPerGroup() {
	const value = Number(process.env.MAX_TRIGGERS_PER_GROUP);
	return Number.isInteger(value) && value > 0 ? value : 5;
}

/** Why `incoming` more triggers cannot join a group holding `current`, or null if they fit. */
export function groupCapRefusal(current: number, incoming: number, max = maxTriggersPerGroup()) {
	if (current + incoming <= max) return null;
	return `A trigger group holds at most ${max} triggers and this one has ${current}. Create another group for the rest.`;
}
