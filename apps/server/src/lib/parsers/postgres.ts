import type { Connection, DbType } from "@fluxify/adapters";

/**
 * Parses a PostgreSQL connection URL.
 *
 * Supported formats:
 *   postgres://user:pass@host:port/db
 *   postgres://user:pass@host:port/db?ssl=true
 *   postgres://user:pass@host:port/db?ssl=1
 *
 * `ssl` is optional – defaults to `false` when omitted.
 */
export function parsePostgresUrl(url: string): Connection | null {
	// 1. scheme://user:pass@host:port/db[?ssl=…]
	const regex = /^postgres:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)(?:\?ssl=(true|false|1|0))?$/i;

	const match = url.match(regex);
	if (!match) return null;

	const [, username, password, host, portStr, database, sslStr] = match;

	const port = Number(portStr);
	const ssl = sslStr === "true" || sslStr === "1"; // defaults to false when undefined

	return {
		username,
		password,
		host,
		port,
		database,
		ssl,
		dbType: "pg" as DbType,
	};
}
