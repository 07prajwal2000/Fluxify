import { systemLog } from "../../lib/systemLogs";
import type { CanvasParentType } from "../canvas/types";
import type { EnvSwitches } from "./observability";

/**
 * How a compile reports itself: the one system log the canvas reads, and the
 * error that says a graph cannot compile (as opposed to a database or NATS
 * failure, which is retried).
 */

/** `type` of every system log the compiler writes; the canvas reads the latest */
export const COMPILE_LOG_TYPE = "compile";

export type CompiledResource = {
	projectId: string;
	resourceType: CanvasParentType;
	resourceId: string;
};

/**
 * A graph that cannot compile. Retrying will not change the answer, so this is
 * recorded for the user instead of being thrown back at the queue — a db or
 * NATS failure still throws and is retried.
 */
export class StaticCompileError extends Error {
	constructor(
		readonly resource: CompiledResource,
		cause: unknown,
	) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

export function compileOrThrow<T>(resource: CompiledResource, compile: () => T): T {
	try {
		return compile();
	} catch (error) {
		throw new StaticCompileError(resource, error);
	}
}

/** `detail.status` of a compile log — what the canvas keys on, never the message */
export type CompileStatus = "compiled" | "inactive" | "failed";

export const logCompiled = (resource: CompiledResource) =>
	systemLog.info({
		...resource,
		type: COMPILE_LOG_TYPE,
		message: "Compiled",
		detail: { status: "compiled" satisfies CompileStatus },
	});

export const logInactive = (resource: CompiledResource, row: EnvSwitches) =>
	systemLog.info({
		...resource,
		type: COMPILE_LOG_TYPE,
		message:
			row.active && row.prodVersionId === null
				? `This ${resource.resourceType} is active but has no promoted version, so it is not deployed`
				: `This ${resource.resourceType} is inactive, so it is not deployed`,
		detail: { status: "inactive" satisfies CompileStatus },
	});

export const logCompileFailed = (error: StaticCompileError) =>
	systemLog.error({
		...error.resource,
		type: COMPILE_LOG_TYPE,
		message: error.message,
		detail: { status: "failed" satisfies CompileStatus },
	});

/**
 * `type` of the log for a route's or workflow's *production* build (#803). It is
 * its own row because the canvas shows the latest `compile` log, and a promoted
 * version that no longer builds is not something the working copy did.
 */
export const PRODUCTION_COMPILE_LOG_TYPE = "compile-production";

export const logProductionCompile = (resource: CompiledResource, error?: StaticCompileError) =>
	error
		? systemLog.error({
				...resource,
				type: PRODUCTION_COMPILE_LOG_TYPE,
				message: `The promoted version does not compile, so production keeps serving the last build: ${error.message}`,
				detail: { status: "failed" satisfies CompileStatus },
			})
		: systemLog.info({
				...resource,
				type: PRODUCTION_COMPILE_LOG_TYPE,
				message: "Compiled",
				detail: { status: "compiled" satisfies CompileStatus },
			});

/**
 * What a build reports. Development's failure is the canvas's to show — and so
 * is production's when nothing is served in development. A production failure
 * with development built goes to its own row and leaves the canvas green.
 */
export async function logBuild(
	resource: CompiledResource,
	row: EnvSwitches,
	failures: Partial<Record<"development" | "production", StaticCompileError>>,
) {
	const servedInDev = row.devActive;
	const blocking = failures.development ?? (servedInDev ? undefined : failures.production);
	if (blocking) await logCompileFailed(blocking);
	else await logCompiled(resource);
	if (row.active === true && row.prodVersionId !== null) {
		await logProductionCompile(resource, failures.production);
	}
}

/** records a static failure; anything else goes back to the queue for a retry */
export async function recordFailure(error: unknown) {
	if (!(error instanceof StaticCompileError)) throw error;
	await logCompileFailed(error);
}
