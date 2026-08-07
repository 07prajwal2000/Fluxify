import Docker from "dockerode";
import { getEnv } from "./env";

export const docker =
	getEnv("CI") === "true"
		? new Docker({ socketPath: "/var/run/docker.sock" })
		: new Docker({ host: "localhost", port: 2375 });

const TEST_PORT_MIN = 20_000;
const TEST_PORT_MAX = 55_000;
const PORT_START_ATTEMPTS = 3;

export function randomTestPort() {
	return Math.floor(Math.random() * (TEST_PORT_MAX - TEST_PORT_MIN + 1)) + TEST_PORT_MIN;
}

/** Retry Docker host-port allocation because concurrent test containers can collide. */
export async function startContainerWithRandomPort(
	create: (port: number) => Promise<Docker.Container>,
) {
	let lastError: unknown;
	for (let attempt = 0; attempt < PORT_START_ATTEMPTS; attempt++) {
		let container: Docker.Container | undefined;
		try {
			const port = randomTestPort();
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
