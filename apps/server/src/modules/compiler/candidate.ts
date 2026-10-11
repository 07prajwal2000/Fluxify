import { compileGraph } from "@fluxify/blocks";
import { deleteArtifact, getArtifact, putArtifact } from "../../db/natsKv";
import type { CanvasSnapshot, CanvasVersionKind } from "../../db/schema";
import { compileDependencies } from "../packages/service";
import { ensureCustomBlocksRegistered, snapshotGraph } from "./service";
import { candidateKey } from "./subjects";

/**
 * A candidate (#739): one version's snapshot, built with hook points the way a
 * suite needs it, and put in the development bucket under a temporary key. The
 * tests gate and a production test run both use it; the run deletes the key
 * when it ends, and `sweepCandidates` catches one a crash left behind.
 */
export type CandidateArtifact = {
	kind: CanvasVersionKind;
	projectId: string;
	versionId: string;
	compiledAt: string;
	source: string;
	settings: CanvasSnapshot["settings"];
};

export async function publishCandidate(o: {
	kind: CanvasVersionKind;
	projectId: string;
	versionId: string;
	snapshot: CanvasSnapshot;
}) {
	await ensureCustomBlocksRegistered(o.projectId);
	const graph = snapshotGraph(o.snapshot);
	const { source } = compileGraph(graph.blocks, graph.edges, {
		projectId: o.projectId,
		dependencies: await compileDependencies(o.projectId),
		asWorkflow: o.kind === "workflow",
		hooks: true,
	});
	const key = candidateKey(
		o.kind,
		o.projectId,
		o.versionId,
		crypto.randomUUID().replaceAll("-", "").slice(0, 8),
	);
	const candidate: CandidateArtifact = {
		kind: o.kind,
		projectId: o.projectId,
		versionId: o.versionId,
		compiledAt: new Date().toISOString(),
		source,
		settings: o.snapshot.settings,
	};
	await putArtifact(key, candidate, "development");
	return { key, candidate };
}

export const readCandidate = (key: string) => getArtifact<CandidateArtifact>(key, "development");

export const dropCandidate = (key: string) => deleteArtifact(key, "development");
