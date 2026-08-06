import Docker from "dockerode";

/**
 * A local daemon on 2375, the mounted socket in CI — the same arrangement the
 * adapter integration tests already require.
 */
export const docker =
	process.env.CI === "true"
		? new Docker({ socketPath: "/var/run/docker.sock" })
		: new Docker({ host: "localhost", port: 2375 });

const TEST_PORT_MIN = 20_000;
const TEST_PORT_MAX = 55_000;
const PORT_START_ATTEMPTS = 3;

export async function startContainerWithRandomPort(
	create: (port: number) => Promise<Docker.Container>,
) {
	let lastError: unknown;
	for (let attempt = 0; attempt < PORT_START_ATTEMPTS; attempt++) {
		let container: Docker.Container | undefined;
		try {
			const port =
				Math.floor(Math.random() * (TEST_PORT_MAX - TEST_PORT_MIN + 1)) +
				TEST_PORT_MIN;
			container = await create(port);
			await container.start();
			return { container, port };
		} catch (error) {
			lastError = error;
			if (container) await container.remove({ force: true }).catch(() => {});
		}
	}
	throw new Error(
		`Unable to start test container after ${PORT_START_ATTEMPTS} random ports.`,
		{ cause: lastError },
	);
}

export function pullImage(image: string): Promise<void> {
	return new Promise((resolve, reject) => {
		docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
			if (err) return reject(err);
			docker.modem.followProgress(stream, (error: Error | null) =>
				error ? reject(error) : resolve(),
			);
		});
	});
}

export async function removeIfPresent(name: string) {
	try {
		await docker.getContainer(name).remove({ force: true });
	} catch {
		// no such container — the normal case
	}
}
