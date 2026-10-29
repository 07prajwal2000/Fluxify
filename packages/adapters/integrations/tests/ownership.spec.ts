import { describe, expect, it } from "bun:test";
import { DbFactory, DbType } from "../../db";
import { KvFactory } from "../../kv/factory";

/**
 * The db and kv caches hold every project's integrations, keyed by id. The
 * factory is the last line before a connection opens, so it refuses a config the
 * caller does not own — the same way for a foreign id as for a missing one.
 */

const pg = { dbType: DbType.POSTGRES, host: "127.0.0.1", port: 1, username: "u", password: "p" };
const redis = { variant: "Redis", host: "127.0.0.1", port: 1, source: "credentials" };

describe("DbFactory ownership", () => {
	it("refuses a config the caller does not own", () => {
		const factory = new DbFactory({ other: pg as never }, undefined, undefined, () => false);
		expect(() => factory.getDbAdapter("other")).toThrow("config is null while creating db adapter");
	});

	it("asks about the config it was handed", () => {
		const seen: unknown[] = [];
		const factory = new DbFactory({ id: pg as never }, undefined, undefined, (config) => {
			seen.push(config);
			return false;
		});
		expect(() => factory.getDbAdapter("id")).toThrow();
		expect(seen).toEqual([pg]);
	});
});

describe("KvFactory ownership", () => {
	it("refuses a config the caller does not own", () => {
		const factory = new KvFactory({ other: redis }, undefined, () => false);
		expect(() => factory.getKvAdapter("other")).toThrow("config is null while creating kv adapter");
	});
});
