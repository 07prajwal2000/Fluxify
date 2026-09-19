import {
	type Connection,
	DbType,
	extractMongoConnectionInfo,
	extractMysqlConnectionInfo,
	extractPgConnectionInfo,
	introspectConnection,
} from "@fluxify/adapters";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { parseMongoUrl } from "../../../../lib/parsers/mongodb";
import { parseMysqlUrl } from "../../../../lib/parsers/mysql";
import { parsePostgresUrl } from "../../../../lib/parsers/postgres";
import { getAppConfigKeysFromData } from "../create/service";
import { getIntegrationByID } from "../get-by-id/repository";
import { getSchema } from "../helpers";
import type { databaseVariantSchema } from "../schemas";
import { decodeAppConfig } from "../test-connection/service";
import type { requestRouteSchema, responseSchema } from "./dto";

export default async function handleRequest(
	params: z.infer<typeof requestRouteSchema>,
): Promise<z.infer<typeof responseSchema>> {
	const integration = await getIntegrationByID(
		params.projectId,
		params.integrationId,
	);
	if (!integration) {
		throw new NotFoundError("Integration not found");
	}
	// ponytail: databases only; other groups get their own metadata shape when they need one.
	if (integration.group !== "database") {
		throw new BadRequestError(
			"Metadata is only available for database integrations",
		);
	}

	const schema = getSchema("database", integration.variant!);
	const parsed = schema?.safeParse(integration.config);
	if (!parsed?.success) {
		throw new BadRequestError("Invalid configuration");
	}

	const appConfigs = await decodeAppConfig(
		getAppConfigKeysFromData(parsed.data),
		params.projectId,
	);
	const connection = buildConnection(
		integration.variant!,
		integration.config,
		appConfigs,
	);

	const tables = await introspectConnection(connection).catch((error) => {
		throw new BadRequestError(
			`Failed to read schema: ${error instanceof Error ? error.message : String(error)}`,
		);
	});

	return {
		id: integration.id,
		name: integration.name!,
		group: integration.group!,
		variant: integration.variant!,
		metadata: { tables },
	};
}

function buildConnection(
	variant: string,
	config: any,
	appConfigs: Map<string, string>,
): Connection {
	switch (variant as z.infer<typeof databaseVariantSchema>) {
		case "PostgreSQL": {
			const cfg = extractPgConnectionInfo(config, appConfigs, parsePostgresUrl);
			if (!cfg) break;
			return {
				...(cfg as Record<string, any>),
				ssl: cfg.ssl == "true",
				dbType: DbType.POSTGRES,
			} as Connection;
		}
		case "MySQL": {
			const cfg = extractMysqlConnectionInfo(config, appConfigs, parseMysqlUrl);
			if (!cfg) break;
			return {
				...(cfg as Record<string, any>),
				dbType: DbType.MYSQL,
			} as Connection;
		}
		case "MongoDB": {
			const cfg = extractMongoConnectionInfo(config, appConfigs, parseMongoUrl);
			if (!cfg) break;
			return {
				...(cfg as Record<string, any>),
				dbType: DbType.MONGODB,
			} as Connection;
		}
	}
	throw new BadRequestError("Invalid configuration");
}
