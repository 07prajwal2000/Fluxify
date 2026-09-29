import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	type Connection,
	DbFactory,
	DbType,
	MONGO_NO_REPLICA_SET,
	MongoAdapter,
} from "@fluxify/adapters";
// subpath import on purpose: the container helpers are test-only
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import type Docker from "dockerode";
import type { BlockDTOType, EdgeDTOSchemaType } from "./builderTypes";
import { BlockTypes } from "./blockTypes";
import { compileGraph } from "./compiler";

/**
 * #513: MongoDB runs transactions only on a replica set. Every other Mongo
 * test uses one, so this is the one place a standalone server is checked: the
 * connection test warns, and a transaction block fails with a clear message
 * instead of the driver's.
 */
const containerName = "fluxify-mongo-standalone-test";
const DB_ID = "mongo-standalone";
let container: Docker.Container | null = null;
let connection: Connection;
let dbFactory: DbFactory;

beforeAll(async () => {
	try {
		await docker.getContainer(containerName).remove({ force: true });
	} catch {}
	await pullImage("mongo:7.0");
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: "mongo:7.0",
			name: containerName,
			// no --replSet: a standalone server
			Cmd: ["mongod", "--bind_ip_all"],
			HostConfig: { PortBindings: { "27017/tcp": [{ HostPort: port.toString() }] } },
		}),
	);
	container = started.container;
	connection = {
		dbType: DbType.MONGODB,
		host: "127.0.0.1",
		port: started.port,
		username: "",
		password: "",
		database: "testdb",
	};
	for (let i = 0; i < 90; i++) {
		if ((await MongoAdapter.testConnection(connection)).success) break;
		await Bun.sleep(500);
	}
	dbFactory = new DbFactory({ [DB_ID]: connection });
}, 120_000);

afterAll(async () => {
	dbFactory?.dispose();
	await DbFactory.ResetConnections();
	await container?.remove({ force: true }).catch(() => {});
});

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const edge = (from: string, to: string, fromHandle = "source") => ({
	id: `edge-${from}-${to}`,
	from,
	to,
	fromHandle,
	toHandle: fromHandle,
});

/** a transaction that inserts one todo; `failure` wires its failure handle to a 409 */
function run(failure: boolean) {
	const blocks = [
		block("in", BlockTypes.entrypoint),
		block("tx", BlockTypes.db_transaction, { connection: DB_ID, executor: "insert" }),
		block("insert", BlockTypes.db_insert, {
			connection: DB_ID,
			tableName: "todos",
			useParam: false,
			data: { source: "raw", value: { title: "in a transaction" } },
		}),
		block("ok", BlockTypes.response, { httpCode: "201" }),
		block("rejected", BlockTypes.response, { httpCode: "409" }),
	];
	const edges: EdgeDTOSchemaType = [
		edge("in", "tx"),
		edge("tx", "insert", "executor"),
		edge("tx", "ok", "success"),
		...(failure ? [edge("tx", "rejected", "failure")] : []),
	];
	const context = { vars: {}, dbFactory, stopper: { timeoutEnd: 0, duration: 30_000 } } as any;
	return compileGraph(blocks, edges).run(context, undefined);
}

describe("MongoDB standalone server", () => {
	it("passes the connection test with a warning", async () => {
		const result = await MongoAdapter.testConnection(connection);
		expect(result).toEqual({ success: true, warning: MONGO_NO_REPLICA_SET });
	});

	it("still runs a plain insert", async () => {
		const row = await dbFactory.getDbAdapter(DB_ID).insert("todos", { title: "plain" });
		expect(row.title).toBe("plain");
	});

	it("fails a transaction with the replica set message on its failure path", async () => {
		const result: any = await run(true);
		expect(JSON.stringify(result)).toContain("MongoDB transactions need a replica set");
		expect(JSON.stringify(result)).not.toContain("Transaction numbers");
	});

	it("fails the route with the same message when nothing handles failure", async () => {
		const result: any = await run(false);
		expect(result.successful).toBe(false);
		expect(result.error.cause.message).toBe(MONGO_NO_REPLICA_SET);
	});

	it("inserts a bulk insert's rows without a transaction, as the block's hint says (#510)", async () => {
		const adapter = dbFactory.getDbAdapter(DB_ID);
		const rows = await adapter.insertBulk("todos", [{ title: "a" }, { title: "b" }], true);
		expect(rows.map((r: { title: string }) => r.title)).toEqual(["a", "b"]);
	});
});
