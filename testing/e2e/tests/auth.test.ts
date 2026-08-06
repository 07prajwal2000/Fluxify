import { beforeEach, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { resetDatabase } from "../src/engines";
import { loadGraph } from "../src/graph";
import { database } from "../src/postgres";
import { runGraph } from "../src/runner";
import { AUTH_USERS, JWT_ISSUER, JWT_SECRET, sha256 } from "../src/seed";

const signup = await loadGraph("auth/signup");
const verifyEmail = await loadGraph("auth/verify-email");
const login = await loadGraph("auth/login");
const session = await loadGraph("auth/session");
const profile = await loadGraph("auth/profile");
const logout = await loadGraph("auth/logout");

const [unverified, verified] = AUTH_USERS;

beforeEach(() => resetDatabase("pg"));

/** Logs in as a seeded account and returns the token the graph issued. */
async function tokenFor(user: (typeof AUTH_USERS)[number]) {
	const run = await runGraph(login, {
		body: { email: user.email, password: user.password },
	});
	expect(run.status).toBe(200);
	return run.body.token as string;
}

function bearer(token: string) {
	return { headers: { authorization: `Bearer ${token}` } };
}

describe("auth/signup", () => {
	it("creates an account and returns it without the hash", async () => {
		const run = await runGraph(signup, {
			body: {
				username: "newcomer",
				email: "newcomer@example.com",
				password: "correct horse battery",
			},
		});

		expect(run.status).toBe(201);
		expect(run.body).toMatchObject({
			username: "newcomer",
			email: "newcomer@example.com",
			verified: false,
		});
		expect(run.body.password_hash).toBeUndefined();
		expect(run.executed).toEqual([
			"entry",
			"find-existing",
			"email-available",
			"hash-password",
			"insert-user",
			"created-body",
			"created",
		]);
	});

	it("stores the password as a sha-256 digest, never the plaintext", async () => {
		const password = faker.internet.password({ length: 16 });
		await runGraph(signup, {
			body: { username: "hashcheck", email: "hashcheck@example.com", password },
		});

		// read the column directly rather than through the graph: the point is
		// what physically landed in the table
		const { sql } = await database();
		const [row] =
			await sql`SELECT password_hash FROM auth_users WHERE email = 'hashcheck@example.com'`;

		expect(row.password_hash).toBe(sha256(password));
		expect(row.password_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(row.password_hash).not.toContain(password);
	});

	it("rejects an email that is already registered", async () => {
		const run = await runGraph(signup, {
			body: {
				username: "impostor",
				email: verified.email,
				password: "another password",
			},
		});

		expect(run.status).toBe(409);
		expect(run.body).toEqual({ error: "email_taken" });
		// the insert must not be on the path — a 409 alone would still pass if the
		// branch ran the happy side and the unique constraint produced the error
		expect(run.executed).not.toContain("insert-user");
		expect(run.executed).toEqual([
			"entry",
			"find-existing",
			"email-available",
			"conflict-body",
			"conflict",
		]);
	});

	it("rejects a short password before any block runs", async () => {
		const run = await runGraph(signup, {
			body: { username: "shorty", email: "shorty@example.com", password: "abc" },
		});

		expect(run.status).toBe(400);
		expect(run.body.message).toBe("Body validation failed");
		expect(run.executed).toEqual([]);
	});
});

describe("auth/verify-email", () => {
	it("flips verified to true", async () => {
		const { sql } = await database();
		const [before] =
			await sql`SELECT id, verified FROM auth_users WHERE email = ${unverified.email}`;
		expect(before.verified).toBe(false);

		const run = await runGraph(verifyEmail, {
			params: { userId: String(before.id) },
		});

		expect(run.status).toBe(200);
		expect(run.body).toMatchObject({ id: before.id, verified: true });

		const [after] =
			await sql`SELECT verified FROM auth_users WHERE id = ${before.id}`;
		expect(after.verified).toBe(true);
	});

	it("404s when the id matches nothing", async () => {
		const run = await runGraph(verifyEmail, { params: { userId: "9999" } });

		expect(run.status).toBe(404);
		expect(run.body).toEqual({ error: "user_not_found" });
	});

	it("400s on a non-numeric id", async () => {
		const run = await runGraph(verifyEmail, { params: { userId: "abc" } });

		expect(run.status).toBe(400);
		expect(run.body.message).toBe("Path parameters validation failed");
		expect(run.executed).toEqual([]);
	});
});

describe("auth/login", () => {
	it("issues a token when the password re-hashes to the stored digest", async () => {
		const run = await runGraph(login, {
			body: { email: verified.email, password: verified.password },
		});

		expect(run.status).toBe(200);
		expect(run.body.user).toMatchObject({
			username: verified.username,
			email: verified.email,
		});
		expect(run.body.token.split(".")).toHaveLength(3);
		expect(run.executed).toEqual([
			"entry",
			"find-user",
			"password-matches",
			"issue-token",
			"logged-in",
		]);
	});

	it("rejects a wrong password", async () => {
		const run = await runGraph(login, {
			body: { email: verified.email, password: "not-the-password" },
		});

		expect(run.status).toBe(401);
		expect(run.body).toEqual({ error: "invalid_credentials" });
		expect(run.executed).not.toContain("issue-token");
	});

	it("rejects an unknown email with the same response as a wrong password", async () => {
		const run = await runGraph(login, {
			body: { email: "nobody@example.com", password: "not-the-password" },
		});

		expect(run.status).toBe(401);
		expect(run.body).toEqual({ error: "invalid_credentials" });
	});

	it("puts the account's roles and issuer in the token", async () => {
		const token = await tokenFor(verified);
		const claims = JSON.parse(
			Buffer.from(token.split(".")[1], "base64url").toString(),
		);

		expect(claims.iss).toBe(JWT_ISSUER);
		expect(claims.roles).toEqual(verified.roles.split(","));
		expect(claims.email).toBe(verified.email);
		// the digest must never travel in a claim
		expect(JSON.stringify(claims)).not.toContain(verified.passwordHash);
	});
});

describe("auth/session", () => {
	it("returns the claims of a valid token", async () => {
		const token = await tokenFor(verified);
		const run = await runGraph(session, bearer(token));

		expect(run.status).toBe(200);
		expect(run.body).toMatchObject({
			iss: JWT_ISSUER,
			email: verified.email,
			username: verified.username,
			roles: verified.roles.split(","),
		});
		expect(run.body.exp).toBeGreaterThan(run.body.iat);
	});

	it("401s without a token", async () => {
		const run = await runGraph(session);

		expect(run.status).toBe(401);
		expect(run.body).toEqual({ error: "unauthenticated" });
		expect(run.executed).not.toContain("claims");
	});

	it("401s on a token signed with a different secret", async () => {
		const token = await tokenFor(verified);
		const [header, payload] = token.split(".");
		const forged = `${header}.${payload}.${"a".repeat(43)}`;

		const run = await runGraph(session, bearer(forged));
		expect(run.status).toBe(401);
	});

	it("401s on a token from another issuer", async () => {
		// signed with the right key, so only the issuer check can reject it
		const jwt = (await import("jsonwebtoken")).default;
		const foreign = jwt.sign({ sub: "1" }, JWT_SECRET, { issuer: "someone-else" });

		const run = await runGraph(session, bearer(foreign));
		expect(run.status).toBe(401);
	});
});

describe("auth/profile", () => {
	it("returns the account the token points at, read from the database", async () => {
		const token = await tokenFor(verified);
		const run = await runGraph(profile, bearer(token));

		expect(run.status).toBe(200);
		expect(run.body).toMatchObject({
			username: verified.username,
			email: verified.email,
		});
		// the profile is a db read, not a claim echo
		expect(run.executed).toContain("load-profile");
		expect(run.body.password_hash).toBeUndefined();
	});

	it("reflects a username changed after the token was issued", async () => {
		const token = await tokenFor(verified);
		const { sql } = await database();
		await sql`UPDATE auth_users SET username = 'renamed' WHERE email = ${verified.email}`;

		const run = await runGraph(profile, bearer(token));
		expect(run.body.username).toBe("renamed");
	});

	it("401s without a token", async () => {
		const run = await runGraph(profile);

		expect(run.status).toBe(401);
		expect(run.executed).not.toContain("load-profile");
	});
});

describe("auth/logout", () => {
	it("acknowledges a valid token", async () => {
		const token = await tokenFor(verified);
		const run = await runGraph(logout, bearer(token));

		expect(run.status).toBe(200);
		expect(run.body.ok).toBe(true);
	});

	it("401s on a missing token", async () => {
		const run = await runGraph(logout);

		expect(run.status).toBe(401);
		expect(run.body).toEqual({ error: "unauthenticated" });
	});
});

describe("seeded accounts", () => {
	it("stores every seeded password as its sha-256 digest", async () => {
		const { sql } = await database();
		const rows =
			await sql`SELECT email, password_hash FROM auth_users ORDER BY id`;

		expect(rows).toHaveLength(AUTH_USERS.length);
		for (const [index, row] of rows.entries()) {
			const user = AUTH_USERS[index];
			expect(row.email).toBe(user.email);
			expect(row.password_hash).toBe(sha256(user.password));
			expect(row.password_hash).not.toContain(user.password);
		}
	});
});
