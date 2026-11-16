// A MinIO container with one bucket, for the object storage backup tests.
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { S3Storage } from "@fluxify/adapters/storage/s3";

// MinIO's own images are gone from Docker Hub and quay (#1105)
const IMAGE = "pgsty/minio:RELEASE.2026-08-04T00-00-00Z";
const USER = "fluxifytest";
const PASS = "fluxifytest-secret";
export const BUCKET = "fluxify-backups";

/** starts a fresh container named `name`, waits for the bucket, and returns how to reach it */
export async function startMinio(name: string) {
	await docker
		.getContainer(name)
		.remove({ force: true })
		.catch(() => {});
	await pullImage(IMAGE);
	const { container, port } = await startContainerWithRandomPort((p) =>
		docker.createContainer({
			Image: IMAGE,
			name,
			Cmd: ["server", "/data"],
			Env: [`MINIO_ROOT_USER=${USER}`, `MINIO_ROOT_PASSWORD=${PASS}`],
			HostConfig: { PortBindings: { "9000/tcp": [{ HostPort: String(p) }] } },
		}),
	);
	const exec = async (cmd: string[]) => {
		const run = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
		const stream = await run.start({});
		await new Promise((resolve) => stream.on("end", resolve).resume());
		return (await run.inspect()).ExitCode;
	};
	for (let i = 0; i < 60; i++) {
		const mc = `mc alias set local http://127.0.0.1:9000 ${USER} ${PASS} && mc mb --ignore-existing local/${BUCKET}`;
		if ((await exec(["sh", "-c", mc])) === 0) break;
		await Bun.sleep(500);
	}
	const s3Config = (over: object = {}) => ({
		endpoint: `http://127.0.0.1:${port}`,
		region: "us-east-1",
		bucket: BUCKET,
		accessKeyId: USER,
		secretAccessKey: PASS,
		forcePathStyle: true,
		...over,
	});
	return {
		s3Config,
		bucket: new S3Storage(s3Config()),
		stop: () => container.remove({ force: true }).catch(() => {}),
	};
}
