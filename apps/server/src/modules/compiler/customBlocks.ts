import {
	compileGraph,
	hasCustomBlock,
	registerCompiledCustomBlock,
	unregisterCustomBlock,
} from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { deleteArtifact, deleteArtifactEverywhere, putArtifact } from "../../db/natsKv";
import {
	type CustomBlockSnapshot,
	customBlocksListEntity,
	middlewaresEntity,
} from "../../db/schema";
import { compileDependencies } from "../packages/service";
import { readSnapshot } from "../versions/repository";
import type { CustomBlockArtifact, MiddlewareArtifact } from "./artifacts";
import {
	type CompiledResource,
	compileOrThrow,
	logCompiled,
	logCompileFailed,
	recordFailure,
	StaticCompileError,
} from "./compileLog";
import { loadGraph, snapshotGraph } from "./graph";
import { loadMiddleware, loadProdMiddleware } from "./middlewares";
import { customBlockKey, middlewareKey } from "./subjects";

/**
 * Custom blocks and middlewares, one artifact per environment (#740).
 *
 * Development runs the working copy and production the promoted version, so the
 * two buckets hold different builds of the same block: it is the shared-library
 * effect, with a promote as the only way a change reaches production. The name
 * is live in both, because it is the key workers find the block under. A block
 * with no promoted version has no production artifact.
 *
 * Custom blocks are compiled first when rebuilding a whole project: a route
 * that calls one only compiles if that block is already in the library.
 */

export async function compileProjectMiddlewares(projectId: string) {
	const rows = await db
		.select({ id: middlewaresEntity.id })
		.from(middlewaresEntity)
		.where(eq(middlewaresEntity.projectId, projectId));
	for (const row of rows) await compileMiddleware(row.id);
}

/**
 * Publish one middleware (#579): its working chain to development and its
 * promoted chain to production. A deleted one is dropped, which needs the
 * project its key lives under since the row is gone.
 */
export async function compileMiddleware(id: string, projectId?: string) {
	const working = await loadMiddleware(id);
	if (!working) {
		if (projectId) await deleteArtifactEverywhere(middlewareKey(projectId, id));
		return;
	}
	const promoted = await loadProdMiddleware(id);
	const key = middlewareKey(working.projectId, id);
	const compiledAt = new Date().toISOString();
	const artifact = (loaded: NonNullable<typeof working>): MiddlewareArtifact => ({
		...loaded.middleware,
		projectId: loaded.projectId,
		compiledAt,
	});
	await Promise.all([
		putArtifact(key, artifact(working), "development"),
		promoted
			? putArtifact(key, artifact(promoted), "production")
			: deleteArtifact(key, "production"),
	]);
	logger.info(`[compiler] published middleware ${working.middleware.name}`, "COMPILER");
}

export async function compileProjectCustomBlocks(projectId: string) {
	const blocks = await db
		.select({ id: customBlocksListEntity.id })
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.projectId, projectId));
	for (const block of blocks) await compileCustomBlock(block.id);
	return blocks.length;
}

/** custom blocks being compiled right now — see `ensureCustomBlocksRegistered` */
const inFlight = new Set<string>();
/** what each custom block id is registered as, so a rename or delete can undo it */
const registeredNames = new Map<string, { projectId: string; name: string }>();

function registerLocally(id: string, projectId: string, name: string, source: string) {
	const previous = registeredNames.get(id);
	// a rename would otherwise leave the old name resolving to this block forever
	if (previous && previous.name !== name) unregisterCustomBlock(projectId, previous.name);
	registerCompiledCustomBlock(projectId, name, source);
	registeredNames.set(id, { projectId, name });
}

function unregisterLocally(id: string) {
	const registered = registeredNames.get(id);
	if (!registered) return;
	unregisterCustomBlock(registered.projectId, registered.name);
	registeredNames.delete(id);
}

/**
 * Makes sure every custom block of a project is in this process's library
 * before something that may call one is compiled.
 *
 * Compiling publishes an artifact for the workers; it does not make the block
 * callable here, and `compileGraph` resolves a non-builtin type by asking the
 * library. Without this, a route compile that happens before the block's own
 * compile — a route saved after a restart, a fresh consumer — fails with
 * "No codegen for block type".
 *
 * Order is discovered rather than declared: a block that calls another is
 * retried once its callee lands. Cycles are impossible (the canvas save
 * refuses them), so the fixpoint always terminates.
 */
export async function ensureCustomBlocksRegistered(projectId: string) {
	const rows = await db
		.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
		.from(customBlocksListEntity)
		// a test block is never in the live library (see compileCustomBlockOrThrow)
		.where(
			and(
				eq(customBlocksListEntity.projectId, projectId),
				ne(customBlocksListEntity.usage, "test"),
			),
		);

	let pending = rows.filter((row) => !hasCustomBlock(projectId, row.name) && !inFlight.has(row.id));
	while (pending.length > 0) {
		const failed: typeof pending = [];
		const errors = new Map<string, unknown>();
		for (const row of pending) {
			try {
				await compileCustomBlockOrThrow(row.id);
			} catch (error) {
				errors.set(row.id, error);
				failed.push(row);
			}
		}
		// Nothing compiled this pass, so the failures are real rather than
		// ordering. Report them and stop retrying, but do not fail the caller:
		// this runs before *every* route compile, so rethrowing here took every
		// route in the project down over one unrelated custom block. A route that
		// actually calls a broken block still fails on its own, and does it with
		// the specific "No codegen for block type: <name>" that names the culprit.
		if (failed.length === pending.length) {
			for (const row of failed) {
				const error = errors.get(row.id);
				if (!(error instanceof StaticCompileError)) {
					logger.error(`[compiler] custom block ${row.name} did not compile`, "COMPILER", {
						error,
					});
					continue;
				}
				await logCompileFailed(error);
			}
			return;
		}
		pending = failed;
	}
}

/** compile one custom block; a deleted one is dropped from the library */
export async function compileCustomBlock(id: string) {
	try {
		await compileCustomBlockOrThrow(id);
	} catch (error) {
		await recordFailure(error);
	}
}

type Build =
	| { source: string; error?: undefined }
	| { source?: undefined; error: StaticCompileError };

/** a static failure is the build's result, not a throw: the other environment still publishes */
function build(
	resource: CompiledResource,
	graph: ReturnType<typeof snapshotGraph>,
	options: Parameters<typeof compileGraph>[2],
): Build {
	try {
		return {
			source: compileOrThrow(resource, () => compileGraph(graph.blocks, graph.edges, options))
				.source,
		};
	} catch (error) {
		if (error instanceof StaticCompileError) return { error };
		throw error;
	}
}

async function compileCustomBlockOrThrow(id: string) {
	const [block] = await db
		.select({
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
			projectId: customBlocksListEntity.projectId,
			usage: customBlocksListEntity.usage,
			prodVersionId: customBlocksListEntity.prodVersionId,
		})
		.from(customBlocksListEntity)
		.where(eq(customBlocksListEntity.id, id));

	if (!block) {
		logger.info(`[compiler] dropping custom block ${id}`, "COMPILER");
		unregisterLocally(id);
		return;
	}
	// test-only (#483): the test runner compiles it itself; workers never get it,
	// and switching a published block to test takes it back off them
	if (block.usage === "test") {
		await dropCustomBlock(block.projectId!, block.id);
		return;
	}

	const resource: CompiledResource = {
		projectId: block.projectId!,
		resourceType: "custom_block",
		resourceId: block.id,
	};

	// a custom block may call another one; same library requirement as a route
	inFlight.add(id);
	let working: Build;
	let promoted: Build | undefined;
	try {
		await ensureCustomBlocksRegistered(block.projectId!);
		// `param:` placeholders resolve from the invocation, not from a caller's data
		const options = {
			asCustomBlock: true,
			projectId: block.projectId!,
			dependencies: await compileDependencies(block.projectId!),
		};
		working = build(resource, await loadGraph({ type: "custom_block", id }), options);
		const snapshot = block.prodVersionId
			? await readSnapshot<CustomBlockSnapshot>(block.prodVersionId)
			: undefined;
		promoted = snapshot ? build(resource, snapshotGraph(snapshot), options) : undefined;
	} finally {
		inFlight.delete(id);
	}

	// The compiler is also a consumer of its own output: the next route to call
	// this block resolves it from here. Only its name matters in this process, so
	// a working copy that does not compile does not hide a promoted one that does.
	const local = working.source ?? promoted?.source;
	if (local !== undefined) registerLocally(block.id, block.projectId!, block.name, local);

	const key = customBlockKey(block.projectId!, block.id);
	const artifact = (source: string): CustomBlockArtifact => ({
		id: block.id,
		name: block.name,
		projectId: block.projectId!,
		source,
		compiledAt: new Date().toISOString(),
	});
	await Promise.all([
		// a build that failed leaves its bucket as it was
		working.source !== undefined
			? putArtifact(key, artifact(working.source), "development")
			: undefined,
		promoted === undefined
			? deleteArtifact(key, "production")
			: promoted.source !== undefined
				? putArtifact(key, artifact(promoted.source), "production")
				: undefined,
	]);

	const failure = working.error ?? promoted?.error;
	if (failure) throw failure;
	await logCompiled(resource);
	logger.info(`[compiler] compiled custom block ${block.name}`, "COMPILER");
}

export async function dropCustomBlock(projectId: string, id: string) {
	unregisterLocally(id);
	await deleteArtifactEverywhere(customBlockKey(projectId, id));
}
