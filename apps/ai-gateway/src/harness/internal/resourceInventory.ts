import {
	appConfigEntity,
	customBlocksListEntity,
	db,
	integrationsEntity,
	routesEntity,
} from "@fluxify/server";
import { logger } from "@fluxify/common";
import { asc, and, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import { unionAll, type PgColumn } from "drizzle-orm/pg-core";
import type { FindResourceResult, ProjectInventoryEntry } from "../types";

export const RESOURCE_LIST_PAGE_SIZE = 20;
const INVENTORY_LIMIT = 20;
const INVENTORY_QUERY_TERMS_LIMIT = 8;

type ListableResourceType = ProjectInventoryEntry["type"];

export interface ResourceListPage {
	items: FindResourceResult[];
	nextCursor?: string;
}

export function encodeResourceCursor(
	type: ListableResourceType,
	id: string,
): string {
	return Buffer.from(JSON.stringify({ type, id })).toString("base64url");
}

export function decodeResourceCursor(
	raw: string,
	expectedType: ListableResourceType,
): string {
	try {
		const value = JSON.parse(Buffer.from(raw, "base64url").toString()) as {
			type?: string;
			id?: string;
		};
		if (value.type !== expectedType || !value.id) throw new Error("invalid");
		if (
			expectedType === "app_config" &&
			(!/^\d+$/.test(value.id) || !Number.isSafeInteger(Number(value.id)))
		) {
			throw new Error("invalid");
		}
		return value.id;
	} catch {
		throw new Error("Invalid cursor for this resource type.");
	}
}

function inventoryTerms(query: string | undefined): string[] {
	return [
		...new Set(
			(query ?? "")
				.toLowerCase()
				.match(/[a-z0-9]+/g)
				?.filter((term) => term.length > 1)
				.slice(0, INVENTORY_QUERY_TERMS_LIMIT) ?? [],
		),
	];
}

function page<T extends FindResourceResult>(
	items: T[],
	type: ListableResourceType,
): ResourceListPage {
	const current = items.slice(0, RESOURCE_LIST_PAGE_SIZE);
	const last = current.at(-1);
	return {
		items: current,
		nextCursor:
			items.length > RESOURCE_LIST_PAGE_SIZE && last
				? encodeResourceCursor(type, last.id)
				: undefined,
	};
}

/** Compact, typed startup inventory. The UNION keeps this to one database
 * round trip; each arm is independently narrowed by user-request terms. */
export async function getProjectInventory(
	projectId: string | undefined,
	query: string | undefined,
): Promise<ProjectInventoryEntry[]> {
	if (!projectId) return [];
	try {
		const terms = inventoryTerms(query);
		if (terms.length === 0) return [];
		const matches = (...columns: PgColumn[]): SQL | undefined => {
			const predicates = terms.flatMap((term) =>
				columns.map((column) => ilike(column, `%${term}%`)),
			);
			return predicates.length ? or(...predicates) : undefined;
		};
		const routes = db
			.select({
				type: sql<ProjectInventoryEntry["type"]>`'route'`.as("type"),
				id: sql<string>`${routesEntity.id}::text`.as("id"),
				identifier:
					sql<string>`coalesce(${routesEntity.method}, '') || ' ' || coalesce(${routesEntity.path}, '')`.as(
						"identifier",
					),
				label: sql<string>`coalesce(${routesEntity.name}, ${routesEntity.path}, '')`.as(
					"label",
				),
			})
			.from(routesEntity)
			.where(
				and(
					eq(routesEntity.projectId, projectId),
					matches(routesEntity.name, routesEntity.path),
				),
			);
		const configs = db
			.select({
				type: sql<ProjectInventoryEntry["type"]>`'app_config'`.as("type"),
				id: sql<string>`${appConfigEntity.id}::text`.as("id"),
				identifier: sql<string>`${appConfigEntity.keyName}`.as("identifier"),
				label: sql<string>`coalesce(${appConfigEntity.description}, ${appConfigEntity.keyName})`.as(
					"label",
				),
			})
			.from(appConfigEntity)
			.where(
				and(
					eq(appConfigEntity.projectId, projectId),
					matches(appConfigEntity.keyName, appConfigEntity.description),
				),
			);
		const integrations = db
			.select({
				type: sql<ProjectInventoryEntry["type"]>`'integration'`.as("type"),
				id: sql<string>`${integrationsEntity.id}::text`.as("id"),
				identifier:
					sql<string>`coalesce(${integrationsEntity.group}, '') || ':' || coalesce(${integrationsEntity.variant}, '')`.as(
						"identifier",
					),
				label: sql<string>`coalesce(${integrationsEntity.name}, '')`.as("label"),
			})
			.from(integrationsEntity)
			.where(
				and(
					eq(integrationsEntity.projectId, projectId),
					matches(
						integrationsEntity.name,
						integrationsEntity.group,
						integrationsEntity.variant,
						integrationsEntity.tags,
					),
				),
			);
		const customBlocks = db
			.select({
				type: sql<ProjectInventoryEntry["type"]>`'custom_block'`.as("type"),
				id: sql<string>`${customBlocksListEntity.id}::text`.as("id"),
				identifier: sql<string>`${customBlocksListEntity.name}`.as("identifier"),
				label: sql<string>`coalesce(${customBlocksListEntity.label}, ${customBlocksListEntity.name})`.as(
					"label",
				),
			})
			.from(customBlocksListEntity)
			.where(
				and(
					eq(customBlocksListEntity.projectId, projectId),
					matches(
						customBlocksListEntity.name,
						customBlocksListEntity.label,
						customBlocksListEntity.description,
					),
				),
			);

		return await unionAll(routes, configs, integrations, customBlocks)
			.orderBy(asc(sql`label`), asc(sql`id`))
			.limit(INVENTORY_LIMIT);
	} catch (error) {
		logger.error("[DbService] Error loading project inventory", { error });
		return [];
	}
}

export async function listRoutes(
	projectId: string,
	afterId?: string,
): Promise<ResourceListPage> {
	const rows = await db
		.select({
			id: routesEntity.id,
			name: routesEntity.name,
			path: routesEntity.path,
			method: routesEntity.method,
		})
		.from(routesEntity)
		.where(
			and(
				eq(routesEntity.projectId, projectId),
				afterId ? gt(routesEntity.id, afterId) : undefined,
			),
		)
		.orderBy(asc(routesEntity.id))
		.limit(RESOURCE_LIST_PAGE_SIZE + 1);
	return page(
		rows.map((row) => ({
			type: "route",
			id: row.id,
			name: row.name || "",
			path: row.path || "",
			method: row.method || "",
		})),
		"route",
	);
}

export async function listAppConfigs(
	projectId: string,
	afterId?: number,
): Promise<ResourceListPage> {
	const rows = await db
		.select({
			id: appConfigEntity.id,
			name: appConfigEntity.keyName,
			description: appConfigEntity.description,
		})
		.from(appConfigEntity)
		.where(
			and(
				eq(appConfigEntity.projectId, projectId),
				afterId !== undefined ? gt(appConfigEntity.id, afterId) : undefined,
			),
		)
		.orderBy(asc(appConfigEntity.id))
		.limit(RESOURCE_LIST_PAGE_SIZE + 1);
	return page(
		rows.map((row) => ({
			type: "app_config",
			id: row.id.toString(),
			name: row.name || "",
			description: row.description || "",
		})),
		"app_config",
	);
}

export async function listIntegrations(
	projectId: string,
	afterId?: string,
): Promise<ResourceListPage> {
	const rows = await db
		.select({
			id: integrationsEntity.id,
			name: integrationsEntity.name,
			group: integrationsEntity.group,
			variant: integrationsEntity.variant,
		})
		.from(integrationsEntity)
		.where(
			and(
				eq(integrationsEntity.projectId, projectId),
				afterId ? gt(integrationsEntity.id, afterId) : undefined,
			),
		)
		.orderBy(asc(integrationsEntity.id))
		.limit(RESOURCE_LIST_PAGE_SIZE + 1);
	return page(
		rows.map((row) => ({
			type: "integration",
			id: row.id,
			name: row.name || "",
			group: row.group || "",
			variant: row.variant || "",
		})),
		"integration",
	);
}

export async function listCustomBlocks(
	projectId: string,
	afterId?: string,
): Promise<ResourceListPage> {
	const rows = await db
		.select({
			id: customBlocksListEntity.id,
			name: customBlocksListEntity.name,
			label: customBlocksListEntity.label,
			description: customBlocksListEntity.description,
			inputParams: customBlocksListEntity.inputParams,
		})
		.from(customBlocksListEntity)
		.where(
			and(
				eq(customBlocksListEntity.projectId, projectId),
				afterId ? gt(customBlocksListEntity.id, afterId) : undefined,
			),
		)
		.orderBy(asc(customBlocksListEntity.id))
		.limit(RESOURCE_LIST_PAGE_SIZE + 1);
	return page(
		rows.map((row) => ({
			type: "custom_block",
			id: row.id,
			name: row.name,
			label: row.label || row.name,
			description: row.description || "",
			inputParams: Array.isArray(row.inputParams) ? row.inputParams : [],
		})),
		"custom_block",
	);
}
