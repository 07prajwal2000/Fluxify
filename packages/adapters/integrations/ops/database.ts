import {
	type Connection,
	DbType,
	type IntegrationOpContext,
	type IntegrationTestResult,
} from "@fluxify/sdk/integrations";
import { z } from "zod";
import { describeConnection, introspectConnection } from "../../db/index";
import { extractMongoConnectionInfo, MongoAdapter } from "../../db/mongoDbAdapter";
import { extractMysqlConnectionInfo, MySqlAdapter } from "../../db/mySqlAdapter";
import { extractPgConnectionInfo, PostgresAdapter } from "../../db/postgresAdapter";
import { parseMongoUrl } from "../parsers/mongodb";
import { parseMysqlUrl } from "../parsers/mysql";
import { parsePostgresUrl } from "../parsers/postgres";

type Extract = (
	config: Record<string, any>,
	appConfigs: Map<string, string>,
	parseUrl: (url: string) => Connection | null,
) => Record<string, any> | null;

/**
 * The stored config -> a design-time `Connection`; an unparseable one throws.
 * Untyped is what Test connection always handed the driver: no `dbType`.
 */
const connection =
	(extract: Extract, parseUrl: (url: string) => Connection | null, dbType: DbType) =>
	(config: any, appConfig: Map<string, string>, typed = true): Connection => {
		const cfg = extract(config, appConfig, parseUrl);
		if (!cfg) throw new Error("Invalid configuration");
		if (dbType === DbType.POSTGRES) cfg.ssl = cfg.ssl == "true";
		return (typed ? { ...cfg, dbType } : cfg) as Connection;
	};

/** `tables` narrows the schema to those tables' detail; absent, names only. */
const inspectRequest = z.object({ tables: z.array(z.string()).optional() });

/** One database variant's ops. `test` reports a driver failure, never throws it. */
function ops(
	toConnection: ReturnType<typeof connection>,
	probe: (cfg: any) => Promise<{ success: boolean; error?: unknown; warning?: string }>,
	/** only MongoDB reports one (a standalone server cannot run transactions) */
	warns = false,
) {
	return {
		async test(config: any, ctx: IntegrationOpContext): Promise<IntegrationTestResult> {
			let cfg: Connection;
			try {
				cfg = toConnection(config, ctx.appConfig, false);
			} catch {
				return { success: false, error: "Invalid configuration" };
			}
			const result = await probe(cfg);
			return {
				success: result.success,
				error: result.error?.toString() || (result.success ? "" : "Connection failed"),
				...(warns ? { warning: result.warning } : {}),
			};
		},
		describe: async (config: any, ctx: IntegrationOpContext) => ({
			tables: await introspectConnection(toConnection(config, ctx.appConfig)),
		}),
		inspect: (config: any, request: z.infer<typeof inspectRequest>, ctx: IntegrationOpContext) =>
			describeConnection(toConnection(config, ctx.appConfig), request.tables),
		inspectRequest,
	};
}

export const DATABASE_OPS = {
	"database/PostgreSQL": ops(
		connection(extractPgConnectionInfo, parsePostgresUrl, DbType.POSTGRES),
		(cfg) => PostgresAdapter.testConnection(cfg),
	),
	"database/MySQL": ops(
		connection(extractMysqlConnectionInfo, parseMysqlUrl, DbType.MYSQL),
		(cfg) => MySqlAdapter.testConnection(cfg),
	),
	"database/MongoDB": ops(
		connection(extractMongoConnectionInfo, parseMongoUrl, DbType.MONGODB),
		(cfg) => MongoAdapter.testConnection(cfg as any),
		true,
	),
};
