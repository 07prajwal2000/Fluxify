import { logger } from "@fluxify/common";
import { StringCodec } from "nats";
import { natsConnection } from "../../db/nats";
import type { CompileRequest } from "./artifacts";
import {
	ALL_PROJECTS,
	compileCustomBlockSubject,
	compileProjectConfigSubject,
	compileProjectSubject,
	compileRouteSubject,
} from "./subjects";

/**
 * Anything that changes a graph asks for a recompile here. Publishing to
 * JetStream (not core NATS) means the request is persisted: if the compiler is
 * restarting, the work is still waiting when it comes back.
 */

const sc = StringCodec();

async function request(subject: string, body: CompileRequest) {
	try {
		const js = natsConnection().jetstream();
		await js.publish(subject, sc.encode(JSON.stringify(body)));
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
