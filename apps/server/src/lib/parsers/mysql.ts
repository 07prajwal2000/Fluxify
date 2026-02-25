import type { Connection, DbType } from "@fluxify/adapters";

/**
 * Parses a MySQL connection URL.
 *
 * Supported formats:
 *   mysql://user:pass@host:port/db
 *   mysql://user:pass@host:port/db?ssl=true
 *   mysql://user:pass@host:port/db?ssl=1
 *
 * `ssl` is optional – defaults to `false` when omitted.
 */
export function parseMysqlUrl(url: string): Connection | null {
	// 1. scheme://user:pass@host:port/db
	const regex = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)$/i;

	const match = url.match(regex);
	if (!match) return null;

	const [, username, password, host, portStr, database] = match;

	const port = Number(portStr);

	return {
		username,
		password,
		host,
		port,
		database,
		dbType: "MySQL" as DbType,
	};
}
