import Docker from "dockerode";
import { MongoClient, type Db } from "mongodb";
import { buildMongoUrl, DbType, type Connection } from "@fluxify/adapters";
import { docker, pullImage, removeIfPresent } from "./docker";

/**
 * One throwaway Mongo for the entire e2e run, started lazily like the Postgres
 * one — a suite that never touches Mongo never pays for the container.
 *
 * Booted as a single-node replica set: transactions require one, and a graph
 * fixture that exercises `db_transaction` should not need a different container
 * than every other Mongo fixture.
 */
const IMAGE = "mongo:7.0";
const CONTAINER = "fluxify-e2e-mongo";
const DATABASE = "fluxify_e2e";

export type TestMongo = {
	connection: Connection;
	db: Db;
};

let starting: Promise<TestMongo> | undefined;
let running: { container: Docker.Container; client: MongoClient } | undefined;

export function mongo(): Promise<TestMongo> {
	return (starting ??= start());
}

export async function stopMongo() {
	if (!running) return;
	const { container, client } = running;
	running = undefined;
	starting = undefined;
	await client.close().catch(() => {});
	await container.stop().catch(() => {});
	await removeIfPresent(CONTAINER);
}

/** Connects, promotes the node to primary, and waits until it accepts writes. */
async function waitForPrimary(client: MongoClient) {
	for (let attempt = 0; attempt < 90; attempt++) {
		try {
			await client.connect();
			await client.db("admin").command({ ping: 1 });
			await initiateReplicaSet(client);
			// election is quick but not instantaneous, and a write before it
			// completes fails with NotWritablePrimary
			await client.db(DATABASE).command({ ping: 1 });
			await Bun.sleep(2000);
			return;
		} catch {
			await Bun.sleep(500);
		}
	}
	throw new Error("mongo container did not become ready");
}

async function initiateReplicaSet(client: MongoClient) {
	try {
		await client.db("admin").command({
			replSetInitiate: {
				_id: "rs0",
				// the member address is how the node sees itself, so it is the
				// container's own port, not the mapped host one. The client reaches
				// it anyway: buildMongoUrl sets directConnection=true, which skips
				// replica set discovery entirely.
				members: [{ _id: 0, host: "127.0.0.1:27017" }],
			},
		});
	} catch (error) {
		const message = (error as Error).message ?? "";
		if (!message.includes("already initialized")) throw error;
	}
}

async function start(): Promise<TestMongo> {
	const port = 20000 + Math.floor(Math.random() * 45000);
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);

	const container = await docker.createContainer({
		Image: IMAGE,
		name: CONTAINER,
		// no root credentials: a keyfile-less replica set cannot be initiated
		// once authentication is enabled
		Cmd: ["mongod", "--replSet", "rs0", "--bind_ip_all"],
		HostConfig: {
			PortBindings: { "27017/tcp": [{ HostPort: String(port) }] },
			AutoRemove: true,
		},
	});
	await container.start();

	const connection: Connection = {
		dbType: DbType.MONGODB,
		host: "127.0.0.1",
		port,
		username: "",
		password: "",
		database: DATABASE,
		ssl: false,
	};

	const client = new MongoClient(buildMongoUrl(connection), {
		serverSelectionTimeoutMS: 1000,
	});
	await waitForPrimary(client);

	running = { container, client };
	return { connection, db: client.db(DATABASE) };
}
