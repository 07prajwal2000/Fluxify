export type ActiveExecution = {
	requestId: string;
	routeId: string;
	timeoutMs: number;
};

export type TimedOutExecution = ActiveExecution & {
	stalledForMs: number;
};

type Clock = () => number;

/**
 * Tracks only active executions while the experimental timeout policy is on.
 * A healthy async operation can outlive its route timeout: it continues to
 * heartbeat. A synchronous CPU loop prevents heartbeats and is selected here
 * for termination by the supervisor.
 */
export class ExecutionWatchdog {
	private enabled = false;
	private lastHeartbeatAt = 0;
	private active = new Map<string, ActiveExecution & { startedAt: number }>();

	constructor(
		private readonly now: Clock = () => performance.now(),
		private readonly heartbeatGraceMs = 1_000,
	) {}

	setEnabled(enabled: boolean) {
		this.enabled = enabled;
		this.lastHeartbeatAt = this.now();
		if (!enabled) this.active.clear();
	}

	heartbeat() {
		if (this.enabled) this.lastHeartbeatAt = this.now();
	}

	start(execution: ActiveExecution) {
		if (!this.enabled) return;
		this.active.set(execution.requestId, { ...execution, startedAt: this.now() });
	}

	finish(requestId: string) {
		this.active.delete(requestId);
	}

	findTimedOut(): TimedOutExecution | undefined {
		if (!this.enabled) return;
		const now = this.now();
		const stalledForMs = now - this.lastHeartbeatAt;
		if (stalledForMs < this.heartbeatGraceMs) return;

		for (const execution of this.active.values()) {
			if (now - execution.startedAt >= execution.timeoutMs) {
				const { startedAt: _, ...timedOut } = execution;
				return { ...timedOut, stalledForMs };
			}
		}
	}
}
