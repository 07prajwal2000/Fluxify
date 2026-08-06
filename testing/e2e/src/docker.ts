import Docker from "dockerode";

/**
 * A local daemon on 2375, the mounted socket in CI — the same arrangement the
 * adapter integration tests already require.
 */
export const docker =
	process.env.CI === "true"
		? new Docker({ socketPath: "/var/run/docker.sock" })
		: new Docker({ host: "localhost", port: 2375 });

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
