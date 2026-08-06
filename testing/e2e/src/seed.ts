import { createHash } from "node:crypto";
import { faker } from "@faker-js/faker";
import type { SQL } from "bun";
import type { Db } from "mongodb";

/**
 * The hash the auth graphs compute in a JS block. Kept here so a test can
 * assert against the stored column independently of the graph that wrote it —
 * if both sides derived the hash from the same helper the test would only
 * prove the two agree, not that the right thing landed in the database.
 */
export function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

export const JWT_SECRET = "e2e-jwt-secret";
export const JWT_ISSUER = "fluxify-e2e";

/**
 * Simulated accounts. Seeded faker, so the fixtures are the same every run and
 * a failure is reproducible; the plaintext passwords stay here (and only here)
 * so a login test can post one and a storage test can hash one.
 *
 * The dot in the local part is load-bearing: a dotted condition *value* used to
 * be parsed as a JSON path and emitted as an identifier, so no email lookup
 * worked at all. Keep it — this is the fixture that catches that coming back.
 */
faker.seed(20260806);
export const AUTH_USERS = Array.from({ length: 5 }, (_, index) => {
	const password = faker.internet.password({ length: 14 });
	return {
		// index-suffixed rather than faker's own address: the columns are UNIQUE
		// and a collision would surface as an opaque seed failure
		username: `${faker.internet.username().toLowerCase().replace(/[^a-z0-9]/g, "")}${index}`,
		email: `${faker.person.firstName().toLowerCase()}.${faker.person.lastName().toLowerCase()}${index}@example.com`,
		password,
		passwordHash: sha256(password),
		// the first account is unverified so the verify-email graph has a subject
		verified: index !== 0,
		roles: index === 0 ? "user" : "user,admin",
	};
});

/**
 * Fixture data, reset before each test.
 *
 * Per engine, not shared: the point of a Mongo fixture is to exercise what
 * Mongo does differently, and forcing it into a relational shape would defeat
 * that. Grow the one your graph needs.
 */

export async function seedPostgres(sql: SQL) {
	await sql`DROP TABLE IF EXISTS orders`;
	await sql`DROP TABLE IF EXISTS users`;
	await sql`DROP TABLE IF EXISTS auth_users`;

	await sql`
		CREATE TABLE auth_users (
			id SERIAL PRIMARY KEY,
			username VARCHAR(255) NOT NULL UNIQUE,
			email VARCHAR(255) NOT NULL UNIQUE,
			password_hash CHAR(64) NOT NULL,
			verified BOOLEAN NOT NULL DEFAULT false,
			roles VARCHAR(255) NOT NULL DEFAULT 'user',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`;
	for (const user of AUTH_USERS) {
		await sql`
			INSERT INTO auth_users (username, email, password_hash, verified, roles)
			VALUES (${user.username}, ${user.email}, ${user.passwordHash}, ${user.verified}, ${user.roles})`;
	}

	await sql`
		CREATE TABLE users (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			email VARCHAR(255) NOT NULL UNIQUE,
			active BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`;
	await sql`
		CREATE TABLE orders (
			id SERIAL PRIMARY KEY,
			user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			total NUMERIC(10, 2) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'pending'
		)`;

	await sql`
		INSERT INTO users (name, email, active) VALUES
			('Ada Lovelace', 'ada@example.com', true),
			('Grace Hopper', 'grace@example.com', true),
			('Alan Turing', 'alan@example.com', false)`;
	await sql`
		INSERT INTO orders (user_id, total, status) VALUES
			(1, 42.50, 'paid'),
			(1, 12.00, 'pending'),
			(2, 99.99, 'paid')`;
}

/**
 * Todo documents. `priority` is deliberately a number and `tags` an array —
 * both are shapes a relational fixture cannot express, and the Mongo adapter
 * has specific behaviour for each (numeric coercion on ordering operators,
 * dotted-path projection).
 */
export const TODOS = [
	{ title: "Write the compiler", status: "done", priority: 1, tags: ["core"] },
	{ title: "Ship tracing", status: "pending", priority: 3, tags: ["core", "obs"] },
	{ title: "Backfill tags", status: "pending", priority: 10, tags: ["chore"] },
	{ title: "Rename variants", status: "pending", priority: 2, tags: ["chore"] },
	{ title: "Delete jaeger", status: "archived", priority: 5, tags: [] },
];

export async function seedMongo(db: Db) {
	await db.collection("todos").deleteMany({});
	// insertMany stamps _id onto the objects it is given; copy so repeated
	// resets do not reuse the ids minted by the previous one
	await db.collection("todos").insertMany(TODOS.map((todo) => ({ ...todo })));
}
