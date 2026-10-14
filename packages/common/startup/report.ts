import { logger } from "../logging";

/**
 * One startup report per process, as plain lines. Admin, orchestrator and
 * worker all record the state of each subsystem, a few human-readable settings,
 * and the addresses they serve, then render it once in a fixed order, so a
 * broken boot can be diffed against a good one (#797).
 *
 * Deliberately plain `logger.info` lines: no box, and nothing project- or
 * user-scoped. Subsystem state, effective settings, health and the address
 * served. Only settings an operator needs to confirm are printed, never a dump
 * of the environment.
 */

export type SubsystemState = "connected" | "pending" | "failed";

interface SubsystemRow {
	name: string;
	state: SubsystemState;
	detail?: string;
}

function stateText(row: SubsystemRow): string {
	if (row.state === "connected") return row.detail ? `connected (${row.detail})` : "connected";
	if (row.state === "failed") return row.detail ? `failed: ${row.detail}` : "failed";
	return row.detail ? `pending (${row.detail})` : "pending";
}

export class StartupReport {
	private readonly subsystems = new Map<string, SubsystemRow>();
	private readonly settings: string[] = [];
	private readonly healthUrls: string[] = [];
	private listenUrl: string | undefined;
	private rendered = false;

	constructor(
		private readonly service: string,
		private readonly detached = false,
	) {}

	/** Records (or replaces) the state of one subsystem. */
	subsystem(name: string, state: SubsystemState, detail?: string): this {
		this.subsystems.set(name, { name, state, detail });
		return this;
	}

	/** One human-readable, already-formatted effective-config line. */
	setting(line: string): this {
		this.settings.push(line);
		return this;
	}

	/** A health/readiness URL this process serves. */
	health(url: string): this {
		this.healthUrls.push(url);
		return this;
	}

	/** The public address the process serves traffic on, printed last. */
	listening(url: string): this {
		this.listenUrl = url;
		return this;
	}

	/**
	 * Prints the report exactly once, as plain lines: subsystem state, settings,
	 * health, then the listening address. No-op when the process never called
	 * `beginStartup` (tests, tooling), so early imports are harmless.
	 */
	render(): void {
		if (this.rendered || this.detached) return;
		this.rendered = true;

		for (const row of this.subsystems.values()) {
			logger.info(`${row.name}: ${stateText(row)}`, "STARTUP");
		}
		for (const line of this.settings) logger.info(line, "STARTUP");
		for (const url of this.healthUrls) logger.info(`health on ${url}`, "STARTUP");
		if (this.listenUrl) logger.info(`listening on ${this.listenUrl}`, "STARTUP");
		logger.info(`${this.service} ready`, "STARTUP");
	}
}

let current: StartupReport | null = null;
const DETACHED = new StartupReport("fluxify", true);

/**
 * Starts the process's report and emits the boot line. Call once per process,
 * from the entrypoint, after `initializeLogger`.
 */
export function beginStartup(service: string, options: { log?: boolean } = {}): StartupReport {
	current = new StartupReport(service);
	if (options.log !== false) logger.info(`starting ${service}`, "STARTUP");
	return current;
}

/** The active report, or a detached no-op when none was begun. */
export function startup(): StartupReport {
	return current ?? DETACHED;
}
