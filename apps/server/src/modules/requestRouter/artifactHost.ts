import { listArtifacts, watchArtifacts } from "../../db/natsKv";
import { artifactKind, projectArtifactFilters } from "../compiler/subjects";
import type {
	ProjectConfigArtifact,
	ProjectConfigPayload,
	UnsealedProjectConfig,
} from "../compiler/artifacts";
import { EncryptionService } from "../../lib/encryption";
import type { ArtifactEntry } from "./compiledRuntime";

/**
 * Supervisor-side half of the pipeline. This is the only place that talks to
 * NATS, and the only place that holds MASTER_ENCRYPTION_KEY — execution threads
 * receive artifacts already unsealed and never open a connection of their own.
 */

/** everything currently published for this project, ready to hand to a thread */
export async function loadProjectArtifacts(
	projectId: string,
): Promise<ArtifactEntry[]> {
	const existing = await listArtifacts<any>(projectArtifactFilters(projectId));
	return existing.map(({ key, value }) => ({ key, value: unseal(key, value) }));
}

/** every later change; the KV update is itself the fan-out signal */
export async function watchProjectArtifacts(
	projectId: string,
	onChange: (entry: ArtifactEntry) => void,
) {
	await watchArtifacts<any>(projectArtifactFilters(projectId), (key, value) =>
		onChange({ key, value: unseal(key, value) }),
	);
}

/**
 * Config is stored encrypted so that read access to the bucket is not read
 * access to every tenant's database password. It is decrypted here, in the
 * thread that has no user code in it.
 */
function unseal(key: string, value: any | null) {
	if (value === null || artifactKind(key) !== "project-config") return value;

	const artifact = value as ProjectConfigArtifact;
	const payload: ProjectConfigPayload = JSON.parse(
		EncryptionService.decrypt(artifact.sealed),
	);
	return {
		projectId: artifact.projectId,
		payload,
		compiledAt: artifact.compiledAt,
	} satisfies UnsealedProjectConfig;
}
