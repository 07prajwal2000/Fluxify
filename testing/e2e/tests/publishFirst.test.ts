import { beforeAll, describe, expect, it } from "bun:test";
import { ensureStreamOnce, natsConnection, publishToStream } from "@fluxify/common/nats";
import { jetstreamManager } from "@nats-io/jetstream";
import { nats } from "../src/nats";

/**
 * #587: the admin can publish before any worker has created the stream (the
 * kit's first boot has no worker). A publish to a subject no stream captures
 * gets "no responders", which the client reports as `JetStreamNotEnabled` —
 * so publishers create the stream themselves.
 *
 * A throwaway stream, not FLUXIFY_TRIGGERS: the broker is shared with suites
 * whose workers already hold consumers on the real one.
 */
beforeAll(nats, 180_000);

describe("publishing before any consumer exists", () => {
	const name = `E2E_PUBLISH_FIRST_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
	const spec = {
		name,
		subjects: [`e2e.${name}.>`],
		retention: "workqueue" as const,
		duplicateWindowMs: 60_000,
	};

	it("fails with the misleading JetStreamNotEnabled when nobody created the stream", async () => {
		const error = await publishToStream(natsConnection(), `e2e.${name}.x`, { n: 0 }).catch(
			(e: Error) => e,
		);
		expect((error as Error).name).toBe("JetStreamNotEnabled");
	});

	it("creates the stream once and keeps the message for a later consumer", async () => {
		const nc = natsConnection();
		await ensureStreamOnce(nc, spec);
		await ensureStreamOnce(nc, spec);
		await publishToStream(nc, `e2e.${name}.x`, { n: 1 });

		const jsm = await jetstreamManager(nc);
		expect((await jsm.streams.info(name)).state.messages).toBe(1);
		await jsm.streams.delete(name);
	});
});
