import { beginStartup, type StartupReport, type SubsystemState, startup } from "@fluxify/common";
import { READY_PATH } from "../modules/requestRouter/health";
import {
	FLUXIFY_CLAIM_ID,
	FLUXIFY_NODE_ID,
	getEnv,
	WORKER_GROUP_IDS,
	WORKER_MODE,
	WORKER_PROJECT_ID,
} from "./env";

/**
 * Server-side helpers for the unified startup report (#797): start it, record
 * subsystem state, print a few human-readable settings, and name the addresses
 * served. Only settings an operator needs to confirm are printed — never a dump
 * of the environment.
 */

/** Begins the process's report. Call once, after `initializeLogger`. */
export function beginServerStartup(service: string): StartupReport {
	return beginStartup(service);
}

/** A `waitFor` callback that records a subsystem's state into the report. */
export function subsystemReporter(name: string) {
	return (state: SubsystemState, detail?: string) => {
		startup().subsystem(name, state, detail);
	};
}

export function subsystemConnected(name: string, detail?: string) {
	startup().subsystem(name, "connected", detail);
}

/** `http://host:port`, mapping an any-interface bind to a usable host name. */
export function localUrl(hostname: string | undefined, port: number | string): string {
	const host = !hostname || hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
	return `http://${host}:${port}`;
}

/** The public address an entrypoint serves traffic on: SERVER_URL, else host:port. */
export function listenUrl(hostname: string | undefined, port: number | string): string {
	return getEnv("SERVER_URL") || localUrl(hostname, port);
}

/** This process's readiness probe URL, on its own local address. */
export function healthUrl(hostname: string | undefined, port: number | string): string {
	return `${localUrl(hostname, port)}${READY_PATH}`;
}

function modeText(mode: string | undefined): string {
	if (mode === "route") return "routes only";
	if (mode === "workflow") return "workflows only";
	return "routes and workflows";
}

function projectText(projectId: string | undefined): string {
	if (!projectId || projectId === "*") return "all projects";
	return projectId;
}

/** Admin control plane: sandbox cap, its public URL and the admin rate limit. */
export function reportServerSettings() {
	const report = startup();
	report.setting(`Max sandboxes per user: ${getEnv("MAX_SANDBOX_PER_USER") || "20"}`);
	if (getEnv("ENABLE_BUILTIN_WORKER") === "true") {
		report.setting(`Builtin worker mode: ${modeText(getEnv("WORKER_MODE"))}`);
		report.setting(`Builtin worker project: ${projectText(getEnv("WORKER_PROJECT_ID"))}`);
	}
	const serverUrl = getEnv("SERVER_URL");
	if (serverUrl) report.setting(`Server URL: ${serverUrl}`);
	const rate = getEnv("ADMIN_RATE_LIMIT_PER_SEC");
	report.setting(
		`Admin rate limit: ${rate === "0" ? "disabled" : `${rate || "15"} requests/second per user`}`,
	);
}

/** Orchestrator: which platform it drives, the worker image and the namespace. */
export function reportOrchestratorSettings() {
	const provider = getEnv("ORCHESTRATOR_PROVIDER") || "docker";
	const report = startup();
	report.setting(`Platform driver: ${provider}`);
	report.setting(`Worker image: ${getEnv("ORCHESTRATOR_WORKER_IMAGE") || "(unset)"}`);
	if (provider === "kubernetes") {
		report.setting(
			`Kubernetes namespace: ${getEnv("K8S_NAMESPACE") || "the orchestrator's own namespace"}`,
		);
	}
}

export interface WorkerSettings {
	mode?: string;
	projectId?: string;
	nodeId?: string;
	claimId?: string;
}

/** A request worker: what it runs, where, and which node it is. */
export function reportWorkerSettings(overrides: WorkerSettings = {}) {
	const report = startup();
	report.setting(`Worker mode: ${modeText(overrides.mode ?? WORKER_MODE)}`);
	report.setting(`Worker project: ${projectText(overrides.projectId ?? WORKER_PROJECT_ID)}`);
	report.setting(`Max triggers per group: ${getEnv("MAX_TRIGGERS_PER_GROUP") || "5"}`);
	report.setting(
		`Worker groups: ${WORKER_GROUP_IDS.length ? WORKER_GROUP_IDS.join(", ") : "all groups"}`,
	);
	report.setting(`Concurrent jobs: ${getEnv("JOBS_CONCURRENCY") || "5"}`);
	const nodeId = overrides.nodeId ?? FLUXIFY_NODE_ID;
	const claimId = overrides.claimId ?? FLUXIFY_CLAIM_ID;
	if (nodeId) {
		report.setting(
			claimId
				? `Node ${nodeId} is a replica of claim ${claimId}`
				: `Node ${nodeId} runs on its own, without a claim`,
		);
	}
}
