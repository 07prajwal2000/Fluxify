export enum DbType {
	POSTGRES = "pg",
	MONGODB = "mongo",
	MYSQL = "mysql",
}

export interface Connection {
	dbType: DbType;
	username: string;
	password: string;
	host: string;
	port: string | number;
	database: string;
	ssl?: boolean;
	/** a query running longer is stopped; unset means DEFAULT_QUERY_TIMEOUT_MS */
	queryTimeoutMs?: number;
}

export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

export type IsolationLevel = "read_committed" | "repeatable_read" | "serializable";

/** " ISOLATION LEVEL ..." for BEGIN / SET TRANSACTION, "" for the database default */
export function isolationClause(isolation?: IsolationLevel) {
	return isolation ? ` ISOLATION LEVEL ${isolation.replace("_", " ").toUpperCase()}` : "";
}
