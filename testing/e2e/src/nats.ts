import { closeNats, connectNats } from "@fluxify/common/nats";
import type Docker from "dockerode";
import {
	docker,
	pullImage,
	removeIfPresent,
	startContainerWithRandomPort,
} from "./docker";

/**
 * One throwaway NATS for the entire e2e run.
 *
 * Same arrangement as the Postgres container: started once, lazily, shared by
 * every test file, torn down from the preloaded teardown. A suite that asks for
 * no queue never launches it.
 *
 * Pinned to the minor the deployment runs. The job consumer uses multi-subject
 * filters (2.10+) and a work-queue stream's one-consumer-per-subject rule is
 * what several of these tests are actually about, so "whatever `latest` is
 * today" is not a safe thing to assert against.
 */
const IMAGE = "nats:2.14-alpine";
const CONTAINER = "fluxify-e2e-nats";
const TOKEN = "e2e-local-only";
const READY_ATTEMPTS = 60;

let starting: Promise<void> | undefined;
let running: Docker.Container | undefined;

/** The shared broker, started on first use. Resolves once it accepts clients. */
export function nats(): Promise<void> {
	return (starting ??= start());
}

/** Stops the container. Called once, from the preloaded suite teardown. */
export async function stopNats() {
	if (!running) return;
	const container = running;
	running = undefined;
	starting = undefined;
	await closeNats().catch(() => {});
	await container.stop().catch(() => {});
	await removeIfPresent(CONTAINER);
}

async function start() {
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);

	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			// -js is not optional: the job queue is a JetStream stream and the
			// artifact bucket is KV, which is JetStream underneath. Without it
			// nothing here provisions and every test fails at startup.
			Cmd: ["-js", "--auth", TOKEN],
			HostConfig: {
				PortBindings: { "4222/tcp": [{ HostPort: String(port) }] },
				// disposable by construction, so a killed run leaves nothing behind
				AutoRemove: true,
			},
		}),
	);
	running = started.container;
	await connectWhenReady(`nats://127.0.0.1:${started.port}`);
}

/**
 * Polls until the server accepts a connection; the container is up well before
 * that.
 *
 * The successful attempt is kept as the process's *default* connection, which
 * is what `natsConnection()` returns throughout apps/server — so the job
 * publisher, the job consumer and the artifact bucket all land on this
 * container without a single environment variable being set.
 */
async function connectWhenReady(url: string) {
	for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
		try {
			await connectNats({ servers: url, token: TOKEN, name: "fluxify.e2e" });
			return;
		} catch {
			await Bun.sleep(250);
		}
	}
	throw new Error("nats container did not become ready");
}
