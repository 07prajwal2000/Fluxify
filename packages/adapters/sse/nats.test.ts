import { afterAll, beforeAll, describe } from "bun:test";
import type Docker from "dockerode";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import { connect } from "@nats-io/transport-node";
import { connectOptions, type NatsConfig } from "../queue/nats";
import { type Harness, brokerSuite, until } from "./brokerSuite";

/** Core NATS pub/sub against a real server, with user/password auth and no JetStream. */

const IMAGE = "nats:2.14";
const CONTAINER = "fluxify-sse-nats-test";
const USER = "fluxify";
const PASS = "s3cret";

let container: Docker.Container | undefined;
let config: NatsConfig;

/** Core NATS only, so readiness is a plain connect (the JetStream account check would fail). */
async function reachable() {
	try {
		await (await connect({ ...connectOptions(config), reconnect: false, timeout: 2_000 })).close();
		return true;
	} catch {
		return false;
	}
}

/** The monitoring port is mapped by Docker and can change on a restart, so ask each time. */
async function monitorPort() {
	const info = await container!.inspect();
	return info.NetworkSettings.Ports["8222/tcp"]![0]!.HostPort;
}

const harness: Harness = {
	source: () => ({ kind: "nats", config }),
	restart: async () => {
		await container!.restart({ t: 1 });
		await until(reachable, 60_000);
	},
	subscribers: async () => {
		const response = await fetch(`http://localhost:${await monitorPort()}/connz`);
		const { connections } = (await response.json()) as { connections: { subscriptions: number }[] };
		return connections.filter((connection) => connection.subscriptions > 0).length;
	},
};

describe("SSE broker on NATS", () => {
	beforeAll(async () => {
		await docker.getContainer(CONTAINER).remove({ force: true }).catch(() => {});
		await pullImage(IMAGE);
		const started = await startContainerWithRandomPort((port) =>
			docker.createContainer({
				Image: IMAGE,
				name: CONTAINER,
				Cmd: ["-m", "8222", "--user", USER, "--pass", PASS],
				ExposedPorts: { "4222/tcp": {}, "8222/tcp": {} },
				HostConfig: {
					PortBindings: {
						"4222/tcp": [{ HostPort: String(port) }],
						"8222/tcp": [{ HostPort: "" }],
					},
				},
			}),
		);
		container = started.container;
		config = { servers: `nats://localhost:${started.port}`, user: USER, pass: PASS };
		await until(reachable, 60_000);
	}, 180_000);

	afterAll(async () => {
		if (container) await container.remove({ force: true }).catch(() => {});
	});

	brokerSuite(() => harness);
});
