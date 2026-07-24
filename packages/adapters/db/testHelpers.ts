import Docker from "dockerode";
import { getEnv } from "../env";

export const isCI = getEnv("CI") === "true";

export const docker = isCI
	? new Docker({ socketPath: "/var/run/docker.sock" })
	: new Docker({ host: "localhost", port: 2375 });

export function pullImage(image: string): Promise<void> {
	return new Promise((resolve, reject) => {
		docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
			if (err) return reject(err);
			docker.modem.followProgress(stream, (err: Error | null) => {
				if (err) return reject(err);
				resolve();
			});
		});
	});
}
