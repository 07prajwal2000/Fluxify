#!/usr/bin/env bun
/**
 * Mints a signed license key against a local issuer keypair.
 *
 * `NON_COMMERCIAL` already grants every enterprise feature, so this exists for
 * the paths it cannot reach: expiry, the grace period, a feature subset, and
 * the licensee name.
 *
 * The keypair and the minted keys live in `.license/`, which is gitignored. The
 * private key obviously must never be committed — but neither should this
 * public key, because it is NOT the Fluxify issuer key and committing it would
 * make a throwaway keypair look official.
 *
 *   bun run --cwd packages/common license:mint -- --licensee acme
 *   bun run --cwd packages/common license:mint -- --licensee acme --days -1            # already expired
 *   bun run --cwd packages/common license:mint -- --licensee acme --days never         # no expiry
 *   bun run --cwd packages/common license:mint -- --licensee acme --features connectors
 *
 * Then point the stack at it (both in `.env`, which is already gitignored):
 *   LICENSE_ISSUER_KEY_PATH=.license/issuer.pub   # lets this build verify
 *   LICENSE_KEY=<the printed token>               # activates it
 *
 * Written up for operators at docs/deployments/self-signed-license.md, which
 * goes away with the 1.0 release along with the whole local-issuer path.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../../..", ".license");
const PRIVATE_KEY = join(DIR, "issuer.key");
const PUBLIC_KEY = join(DIR, "issuer.pub");
const MINTED = join(DIR, "test.license");

function flag(name: string, fallback?: string): string {
	const at = process.argv.indexOf(`--${name}`);
	const value = at === -1 ? undefined : process.argv[at + 1];
	if (value === undefined) {
		if (fallback === undefined) throw new Error(`--${name} is required`);
		return fallback;
	}
	return value;
}

/** The keypair is generated once and then reused, so earlier keys keep verifying. */
function issuerPrivateKey(): string {
	if (existsSync(PRIVATE_KEY)) return readFileSync(PRIVATE_KEY, "utf8");
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
	mkdirSync(DIR, { recursive: true });
	writeFileSync(PRIVATE_KEY, pem);
	writeFileSync(PUBLIC_KEY, publicKey.export({ type: "spki", format: "pem" }) as string);
	console.log(`generated a new issuer keypair in ${DIR}`);
	return pem;
}

const licensee = flag("licensee");
const days = Number(flag("days", "365"));
const features = flag("features", "*").split(",");

// A non-numeric --days (e.g. `never`) omits `exp` entirely, which is the
// "perpetual" shape `verifySigned` accepts.
const claims: Record<string, unknown> = { sub: licensee, features };
if (Number.isFinite(days)) claims.exp = Math.floor(Date.now() / 1000) + days * 86_400;

const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const body = `${segment({ alg: "EdDSA", typ: "JWT" })}.${segment(claims)}`;
const token = `${body}.${sign(null, Buffer.from(body), issuerPrivateKey()).toString("base64url")}`;

writeFileSync(MINTED, `${token}\n`);
console.log(`\n${token}\n`);
console.log(
	`licensee=${licensee} features=${features.join(",")} ${Number.isFinite(days) ? `expires in ${days} day(s)` : "no expiry"}`,
);
console.log(`saved to ${MINTED}`);
