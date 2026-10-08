import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { faker } from "@faker-js/faker";
import type Docker from "dockerode";
import { createPool, type Pool } from "mysql2";
import { describeSql, type SqlRun } from "./describe";
import { MYSQL_POOL_OPTIONS, MySqlAdapter } from "./mySqlAdapter";
import { docker, pullImage, startContainerWithRandomPort } from "./testHelpers";

// schema reads (introspect, describeSql), split from mySqlAdapter.test.ts to keep it under the FTA cap
const containerName = "fluxify-mysql-schema-test";
let container: Docker.Container | null = null;
let db: any;
let pool: Pool;

beforeAll(async () => {
	await docker
		.getContainer(containerName)
		.remove({ force: true })
		.catch(() => {});
	await pullImage("mysql:8.0.36-bullseye");
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: "mysql:8.0.36-bullseye",
			name: containerName,
			Env: ["MYSQL_ROOT_PASSWORD=12345", "MYSQL_DATABASE=testdb"],
			HostConfig: { PortBindings: { "3306/tcp": [{ HostPort: port.toString() }] } },
		}),
	);
	container = started.container;
	const connInfo = { host: "127.0.0.1", port: started.port, user: "root", password: "12345", database: "testdb" };
	for (let i = 0; i < 90; i++) {
		const probe = createPool({ ...connInfo, connectionLimit: 1 });
		const ok = await probe
			.promise()
			.query("SELECT 1")
			.then(() => true)
			.catch(() => false);
		await probe
			.promise()
			.end()
			.catch(() => {});
		if (ok) break;
		if (i === 89) throw new Error("MySQL container did not become ready in time.");
		await new Promise((r) => setTimeout(r, 500));
	}
	pool = createPool({ ...connInfo, ...MYSQL_POOL_OPTIONS });
	db = MySqlAdapter.createKysely(pool);
}, 120000);

afterAll(async () => {
	if (pool) await pool.promise().end();
	await container?.remove({ force: true }).catch(() => {});
});

describe("MySQL schema reads", () => {
	test("introspect: tables, column types and foreign key owners", async () => {
		const adapter = new MySqlAdapter(db, pool);
		const suffix = faker.string.alphanumeric(8).toLowerCase();
		const parent = `authors_${suffix}`;
		const child = `books_${suffix}`;
		await adapter.raw(
			`CREATE TABLE ${parent} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL)`,
		);
		await adapter.raw(
			`CREATE TABLE ${child} (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), author_id INT, FOREIGN KEY (author_id) REFERENCES ${parent}(id))`,
		);

		const schema = await adapter.introspect();
		const books = schema.find((t) => t.table === child);
		expect(books).toBeDefined();
		expect(schema.some((t) => t.table === parent)).toBe(true);

		const title = books!.columns.find((c) => c.name === "title");
		expect(title?.type).toBe("varchar(255)");
		// a plain column is owned by its own table
		expect(title?.owner).toBe(child);
		// a foreign key is owned by the table it references
		expect(books!.columns.find((c) => c.name === "author_id")?.owner).toBe(
			parent,
		);
	});

	test("describeSql: names, then columns, keys and indexes (#652)", async () => {
		const run: SqlRun = async (q, p) => (await pool.promise().query(q, p))[0] as any[];
		const t = `m_${faker.string.alphanumeric(8).toLowerCase()}`;
		await run(`CREATE TABLE ${t} (id INT PRIMARY KEY, email VARCHAR(50) NOT NULL DEFAULT 'x', p INT, UNIQUE KEY ue (email), CONSTRAINT fk FOREIGN KEY (p) REFERENCES ${t}(id))`, []);
		expect(((await describeSql("mysql", run)) as any).tables).toContain(t);
		expect(((await describeSql("mysql", run, [t])) as any).tables[0]).toMatchObject({
			columns: [{ name: "id" }, { name: "email", type: "varchar(50)", nullable: false, default: "x" }, { name: "p", nullable: true }],
			primaryKey: ["id"],
			foreignKeys: [{ name: "fk", definition: `FOREIGN KEY (p) REFERENCES ${t}(id)` }],
			indexes: expect.arrayContaining([{ name: "ue", definition: "UNIQUE (email)" }]),
		});
	});
});
