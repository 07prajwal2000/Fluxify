import { afterEach, describe, expect, it } from "bun:test";
import {
	encodePayload,
	type OutgoingMessage,
	QueueProducer,
	QueueProducerFactory,
	type SendOutcome,
} from "@fluxify/adapters";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType } from "../../builderTypes";
import { compileGraph } from "../../compiler";

/** refuses any message whose payload says so; records everything it was handed */
class FakeProducer extends QueueProducer {
	sent: OutgoingMessage[] = [];
	closed = 0;
	hang = false;
	readonly raw = { publish: async (subject: string) => `published ${subject}`, close() {} };

	async send(messages: OutgoingMessage[]): Promise<SendOutcome[]> {
		if (this.hang) return new Promise(() => {});
		this.sent.push(...messages);
		return messages.map((message, index) => {
			try {
				encodePayload(message.payload);
			} catch (error) {
				return { index, ok: false, error: (error as Error).message };
			}
			return (message.payload as { reject?: boolean })?.reject
				? { index, ok: false, error: "refused" }
				: { index, ok: true, result: { destination: message.destination, offset: String(index) } };
		});
	}

	async client() {
		return this.raw;
	}

	async close() {
		this.closed++;
	}
}

let producer: FakeProducer;

function context(config: Record<string, unknown> = {}, owns = () => true) {
	producer = new FakeProducer();
	const queue = { "conn-1": { variant: "Kafka", ...config } };
	return {
		route: "/send",
		apiId: "api-1",
		projectId: "proj-1",
		vars: {} as Record<string, any>,
		queueFactory: new QueueProducerFactory(queue, {}, owns, async () => ({
			createConnection: () => {
				throw new Error("unused");
			},
			createProducer: () => producer,
		})),
		stopper: { timeoutEnd: 0, duration: 10000 },
	} as any;
}

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const edge = (from: string, to: string, toHandle = "source") => ({
	id: `edge-${from}-${to}-${toHandle}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});

/** entrypoint -> send -> ok (200) on success, err (500) on failure unless left out */
async function run(data: any, input: unknown = null, ctx = context(), withFailure = true) {
	const blocks = [
		block("in", BlockTypes.entrypoint),
		block("send", BlockTypes.queue_send, { connection: "conn-1", destination: "orders", ...data }),
		block("ok", BlockTypes.response, { httpCode: "200" }),
		block("err", BlockTypes.response, { httpCode: "500" }),
	];
	const edges: EdgeDTOSchemaType = [
		edge("in", "send"),
		edge("send", "ok", "success"),
		...(withFailure ? [edge("send", "err", "failure")] : []),
	];
	const result: any = await compileGraph(blocks, edges).run(ctx, input);
	return { result, ctx, status: Number(result.output?.httpCode), body: result.output?.body };
}

afterEach(() => QueueProducerFactory.closeAll());

describe("compiled send message block", () => {
	it("sends one message with its settings and takes the success branch", async () => {
		const { status, body } = await run({
			payload: { source: "raw", value: { id: "js:return input.id" } },
			key: "js:return 'user-' + input.id",
			headers: { source: "web" },
			options: { partition: 2 },
		}, { id: 7 });

		expect(status).toBe(200);
		expect(body).toEqual({ destination: "orders", offset: "0" });
		expect(producer.sent).toEqual([
			{
				destination: "orders",
				payload: { id: 7 },
				key: "user-7",
				headers: { source: "web" },
				options: { partition: 2 },
			},
		]);
	});

	it("sends the previous block's output when useParam is on", async () => {
		await run({ useParam: true, payload: { source: "raw", value: "unused" } }, { order: 1 });
		expect(producer.sent[0]!.payload).toEqual({ order: 1 });
	});

	it("runs js payload code", async () => {
		await run({ payload: { source: "js", value: "js:return input.n * 2" } }, { n: 21 });
		expect(producer.sent[0]!.payload).toBe(42);
	});

	it("takes the failure branch with the reason, and saves it", async () => {
		const { status, body, ctx } = await run(
			{
				payload: { source: "raw", value: { reject: true } },
				saveAsVariable: { enabled: true, name: "sendResult" },
			},
		);
		expect(status).toBe(500);
		expect(body).toEqual({ error: "refused" });
		expect(ctx.vars.outputs.sendResult).toEqual({ error: "refused" });
	});

	it("goes to the error handler when no failure branch is wired", async () => {
		const { result } = await run(
			{ payload: { source: "raw", value: { reject: true } } },
			null,
			context(),
			false,
		);
		expect(result.error.message).toBe("failed to send message: refused");
	});

	it("fails a message with no destination without calling the broker", async () => {
		const { status, body } = await run({ destination: "" });
		expect(status).toBe(500);
		expect(body.error).toContain("No destination");
		expect(producer.sent).toEqual([]);
	});

	it("gives up on a broker that does not answer in the integration's timeout", async () => {
		const ctx = context({ sendTimeoutMs: 20 });
		producer.hang = true;
		const { status, body } = await run({}, null, ctx);
		expect(status).toBe(500);
		expect(body.error).toContain("No answer from the broker in 20 ms");
	});

	it("refuses an integration the project does not own", async () => {
		const { status, body } = await run({}, null, context({}, () => false));
		expect(status).toBe(500);
		expect(body.error).toContain("No message queue integration");
	});
});

describe("bulk send", () => {
	const list = [
		{ id: 1 },
		{ payload: { reject: true } },
		{ payload: { id: 3 }, destination: "audit", key: "k3", headers: { trace: "t" }, delaySeconds: 5 },
	];

	it("sends each item, with per-item overrides on top of the shared settings", async () => {
		await run({ bulk: true, payload: { source: "raw", value: list }, headers: { app: "x" } });
		expect(producer.sent.map((m) => m.destination)).toEqual(["orders", "orders", "audit"]);
		expect(producer.sent[0]!.payload).toEqual({ id: 1 });
		expect(producer.sent[2]).toEqual({
			destination: "audit",
			payload: { id: 3 },
			key: "k3",
			headers: { app: "x", trace: "t" },
			options: { delaySeconds: 5 },
		});
	});

	it("reports partial failure on the success branch by default", async () => {
		const { status, body } = await run({ bulk: true, payload: { source: "raw", value: list } });
		expect(status).toBe(200);
		expect(body.sent.map((s: { index: number }) => s.index)).toEqual([0, 2]);
		expect(body.failed).toEqual([{ index: 1, error: "refused" }]);
	});

	it("takes the failure branch on any failure when asked", async () => {
		const { status, body } = await run({
			bulk: true,
			failWhen: "any",
			payload: { source: "raw", value: list },
		});
		expect(status).toBe(500);
		expect(body.failed).toHaveLength(1);
	});

	it("takes the failure branch when every message failed", async () => {
		const { status, body } = await run({
			bulk: true,
			// a function cannot be sent as JSON
			payload: { source: "js", value: "js:return [{ payload: { reject: true } }, { run: () => 1 }]" },
		});
		expect(status).toBe(500);
		expect(body.sent).toEqual([]);
		expect(body.failed.map((f: { index: number }) => f.index)).toEqual([0, 1]);
	});

	it("succeeds on an empty list without calling the broker", async () => {
		const { status, body } = await run({ bulk: true, payload: { source: "raw", value: [] } });
		expect(status).toBe(200);
		expect(body).toEqual({ sent: [], failed: [] });
	});

	it("fails when the list is not a list", async () => {
		const { status, body } = await run({ bulk: true, payload: { source: "js", value: "js:return 'nope'" } });
		expect(status).toBe(500);
		expect(body).toEqual({ error: "Bulk mode needs a list of messages" });
	});

	it("lets the input decide with useParam: a list is bulk, anything else one message", async () => {
		const listed = await run({ useParam: true }, [{ id: 1 }, { id: 2 }]);
		expect(listed.body.sent).toHaveLength(2);
		expect(producer.sent.map((m) => m.payload)).toEqual([{ id: 1 }, { id: 2 }]);

		// the saved Single/Bulk choice is ignored
		const single = await run({ useParam: true, bulk: true }, { id: 3 });
		expect(single.body).toEqual({ destination: "orders", offset: "0" });
	});
});

describe("raw mode", () => {
	it("hands the client to the code, returns its result and removes it afterwards", async () => {
		const { status, body, ctx } = await run({
			mode: "raw",
			js: "return await client.publish('orders.created')",
		});
		expect(status).toBe(200);
		expect(body).toBe("published orders.created");
		expect(ctx.vars.client).toBeUndefined();
	});

	it("refuses to let user code close the shared client", async () => {
		const { status, body } = await run({ mode: "raw", js: "client.close(); return 1" });
		expect(status).toBe(500);
		expect(body.error).toContain("close() is not allowed");
		expect(producer.closed).toBe(0);
	});
});

describe("producer reuse", () => {
	it("reuses one producer per integration and closes it when the config changes", async () => {
		const ctx = context();
		await run({}, null, ctx);
		const first = producer;
		await run({}, null, ctx);
		expect(producer).toBe(first);

		QueueProducerFactory.synchronize({ "conn-1": { variant: "Kafka", brokers: "other:9092" } });
		await Bun.sleep(0);
		expect(first.closed).toBe(1);
	});
});
