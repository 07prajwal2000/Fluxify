import { logger } from "@fluxify/common";
import { publishToStream } from "@fluxify/common/nats";
import { natsConnection } from "../../db/nats";
import type { CompileRequest } from "./artifacts";
import {
	ALL_PROJECTS,
	compileCustomBlockSubject,
	compileProjectConfigSubject,
	compileProjectSubject,
	compileRouteSubject,
	compileWorkflowSubject,
} from "./subjects";

/**
 * Anything that changes a graph asks for a recompile here. Publishing to
 * JetStream (not core NATS) means the request is persisted: if the compiler is
 * restarting, the work is still waiting when it comes back.
 */

async function request(subject: string, body: CompileRequest) {
	try {
		await publishToStream(natsConnection(), subject, body);
	} catch (error) {
		logger.error(
			`[compiler] failed to queue ${subject}: ${String(error)}`,
			"COMPILER.publish",
		);
	}
}

export function requestRouteCompile(routeId: string, reason?: string) {
	return request(compileRouteSubject(routeId), { id: routeId, reason });
}

export function requestCustomBlockCompile(id: string, reason?: string) {
	return request(compileCustomBlockSubject(id), { id, reason });
}

export function requestWorkflowCompile(workflowId: string, reason?: string) {
	return request(compileWorkflowSubject(workflowId), { id: workflowId, reason });
}

export function requestProjectConfigPublish(
	projectId = ALL_PROJECTS,
	reason?: string,
) {
	return request(compileProjectConfigSubject(projectId), {
		projectId,
		reason,
	});
}

/** full rebuild — config, then custom blocks, then every active route */
export function requestProjectCompile(projectId: string, reason?: string) {
	return request(compileProjectSubject(projectId), { projectId, reason });
}
