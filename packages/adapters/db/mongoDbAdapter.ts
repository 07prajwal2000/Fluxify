import type { DbOperator } from "@fluxify/lib";
import { type ClientSession, type Db, MongoClient, ObjectId } from "mongodb";
import {
	type Connection,
	type DBConditionType,
	DbAdapterMode,
	type IDbAdapter,
	type IntrospectedTable,
	type QueryOptions,
} from ".";
import {
	activeConditions,
	conditionValue,
	effectiveOperator,
	foldConditions,
	isRawCondition,
	isValueless,
	type LeafCondition,
	listValue,
	rangeValue,
	rawMongoFilter,
	regexPattern,
	textValue,
} from "./conditions";
import { isColumnRef, isLiteralRef, isNumericLike, toMongoField } from "./jsonPath";
import { activeSorts, type DbSort, withTiebreaker } from "./sort";

/** a Mongo sort spec in entry order: `id` means `_id`, and `_id` goes last as the tiebreaker */
function sortSpec(sort: DbSort[]): Record<string, 1 | -1> {
	const sorts = activeSorts(sort).map((s) =>
		s.attribute === "id" ? { ...s, attribute: "_id" } : s,
	);
	return Object.fromEntries(
		withTiebreaker(sorts, ["_id"], "").map((s) => [s.attribute, s.direction === "asc" ? 1 : -1]),
	);
}

export class MongoAdapter implements IDbAdapter {
	public static variant = "MongoDB";
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;
	private readonly HARD_LIMIT = 1000;

	private session: ClientSession | null = null;

	constructor(
		private readonly client: MongoClient,
		private readonly db: Db,
	) {}

	public static async testConnection(
		connection: Connection,
	): Promise<{ success: boolean; error?: unknown }> {
		let tempClient: MongoClient | null = null;
		try {
			tempClient = new MongoClient(buildMongoUrl(connection), {
				serverSelectionTimeoutMS: 2000,
			});
			await tempClient.connect();
			await tempClient.db("admin").command({ ping: 1 });
			return { success: true };
		} catch (error) {
			return { success: false, error };
		} finally {
			if (tempClient) await tempClient.close();
		}
	}

	async raw(): Promise<Db> {
		return this.db;
	}

	// Mongo has no schema: infer field names/types from the first 5 documents.
	// ponytail: top-level fields only; walk nested objects if the UI needs dotted paths.
	async introspect(): Promise<IntrospectedTable[]> {
		const collections = await this.db.listCollections().toArray();
		const result: IntrospectedTable[] = [];

		for (const { name } of collections) {
			const docs = await this.db.collection(name).find({}).limit(5).toArray();
			const types = new Map<string, Set<string>>();
			for (const doc of docs) {
				for (const [key, value] of Object.entries(doc)) {
					const field = key === "_id" ? "id" : key;
					if (!types.has(field)) types.set(field, new Set());
					types.get(field)!.add(mongoTypeOf(value));
				}
			}
			result.push({
				table: name,
				columns: [...types].map(([field, kinds]) => ({
					name: field,
					type: [...kinds].sort().join(" | "),
					owner: name,
				})),
			});
		}
		return result;
	}

	// joins are ignored for Mongo (the Joins tab says so when Mongo is selected);
	// only `columns` applies, as a field projection.
	async getAll(
		table: string,
		conditions: DBConditionType[],
		limit: number = this.HARD_LIMIT,
		offset: number = 0,
		sort: DbSort[] = [],
		options?: QueryOptions,
	): Promise<unknown[]> {
		const filter = this.buildFilter(conditions);
		const l = limit < 0 || limit > this.HARD_LIMIT ? this.HARD_LIMIT : limit;

		const docs = await this.db
			.collection(table)
			.find(filter, this.findOptions(options))
			.sort(sortSpec(sort))
			.skip(offset)
			.limit(l)
			.toArray();

		return docs.map(this.mapDoc);
	}

	async getSingle(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<unknown | null> {
		const filter = this.buildFilter(conditions);
		// unsorted stays unsorted: a sort nobody asked for only costs time
		const sort = activeSorts(options?.sort).length ? sortSpec(options?.sort ?? []) : undefined;
		const doc = await this.db
			.collection(table)
			.findOne(filter, { ...this.findOptions(options), ...(sort && { sort }) });
		return this.mapDoc(doc);
	}

	async count(table: string, conditions: DBConditionType[]): Promise<number> {
		return this.db
			.collection(table)
			.countDocuments(this.buildFilter(conditions), this.getOptions());
	}

	async delete(table: string, conditions: DBConditionType[]): Promise<boolean> {
		const filter = this.buildFilter(conditions);
		const result = await this.db.collection(table).deleteMany(filter, this.getOptions());
		return result.deletedCount > 0;
	}

	async insert(table: string, data: unknown, pkColumn: string = "id"): Promise<unknown> {
		const cleanData = { ...(data as Record<string, unknown>) };
		delete cleanData.id;
		delete cleanData._id;

		const result = await this.db.collection(table).insertOne(cleanData, this.getOptions());
		const doc = await this.db
			.collection(table)
			.findOne({ _id: result.insertedId }, this.getOptions());

		return this.mapDoc(doc);
	}

	async insertBulk(
		table: string,
		data: Record<string, unknown>[],
		useTransaction = false,
	): Promise<unknown[]> {
		if (!data || data.length === 0) return [];

		const cleanData = data.map((d) => {
			const { id, _id, ...rest } = d;
			return rest;
		});

		const insertAll = async (options: { session?: ClientSession }) => {
			const result = await this.db.collection(table).insertMany(cleanData, options);
			const ids = Object.values(result.insertedIds);
			const docs = await this.db
				.collection(table)
				.find({ _id: { $in: ids } }, options)
				.toArray();
			return docs.map(this.mapDoc);
		};

		if (!useTransaction || this.mode === DbAdapterMode.TRANSACTION)
			return insertAll(this.getOptions());

		const session = this.client.startSession();
		try {
			session.startTransaction();
			const docs = await insertAll({ session });
			await session.commitTransaction();
			return docs;
		} catch (error) {
			await session.abortTransaction().catch(() => {});
			// a standalone server has no transactions: insert without one, as the block's hint says
			if (!isTransactionUnsupported(error)) throw error;
			return insertAll({});
		} finally {
			await session.endSession();
		}
	}

	async update(
		table: string,
		data: unknown,
		conditions: DBConditionType[],
		pkColumn: string = "id",
	): Promise<unknown[]> {
		const filter = this.buildFilter(conditions);

		const docsToUpdate = await this.db.collection(table).find(filter, this.getOptions()).toArray();
		const ids = docsToUpdate.map((d) => d._id);

		if (ids.length > 0) {
			const cleanData = { ...(data as Record<string, unknown>) };
			delete cleanData.id;
			delete cleanData._id;

			await this.db
				.collection(table)
				.updateMany({ _id: { $in: ids } }, { $set: cleanData }, this.getOptions());
		}

		const updatedDocs = await this.db
			.collection(table)
			.find({ _id: { $in: ids } }, this.getOptions())
			.toArray();

		return updatedDocs.map(this.mapDoc);
	}

	async setMode(mode: DbAdapterMode): Promise<void> {
		this.mode = mode;
	}

	async startTransaction(): Promise<void> {
		if (this.mode === DbAdapterMode.TRANSACTION) return;

		this.session = this.client.startSession();
		this.session.startTransaction();
		await this.setMode(DbAdapterMode.TRANSACTION);
	}

	async commitTransaction(): Promise<void> {
		if (this.mode !== DbAdapterMode.TRANSACTION || !this.session)
			throw new Error("Not in transaction mode");

		try {
			await this.session.commitTransaction();
		} finally {
			await this.session.endSession();
			this.session = null;
			await this.setMode(DbAdapterMode.NORMAL);
		}
	}

	async rollbackTransaction(): Promise<void> {
		if (this.mode !== DbAdapterMode.TRANSACTION || !this.session)
			throw new Error("Not in transaction mode");

		try {
			await this.session.abortTransaction();
		} finally {
			await this.session.endSession();
			this.session = null;
			await this.setMode(DbAdapterMode.NORMAL);
		}
	}

	// ------------------------------------------------------------------
	// Private Helpers
	// ------------------------------------------------------------------

	private getOptions() {
		return this.mode === DbAdapterMode.TRANSACTION && this.session ? { session: this.session } : {};
	}

	// Merges the transaction session with a field projection built from
	// `columns`. "*"/"table.*"/empty means no projection (all fields). Aliases
	// (AS) don't apply to Mongo and are dropped; bracket indexes become dots.
	private findOptions(options?: QueryOptions) {
		const base = this.getOptions();
		const cols = options?.columns;
		if (!cols || cols.length === 0 || cols.some((c) => c.includes("*"))) return base;

		const projection: Record<string, 1> = {};
		for (const raw of cols) {
			const expr = raw.split(/\s+as\s+/i)[0].trim();
			projection[expr === "id" ? "_id" : toMongoField(expr)] = 1;
		}
		return { ...base, projection };
	}

	// Arrow function preserves 'this' context when used in array mappings
	private mapDoc = (doc: Record<string, unknown> | null) => {
		if (!doc) return null;
		const { _id, ...rest } = doc;
		return { id: _id ? String(_id) : undefined, ...rest };
	};

	private buildFilter(conditions: DBConditionType[]): Record<string, unknown> {
		const active = activeConditions(conditions);
		if (active.length === 0) return {};

		return foldConditions<Record<string, unknown>>(
			active,
			(cond) => this.createExpr(cond),
			(chain, left, right) => ({ [chain === "or" ? "$or" : "$and"]: [left, right] }),
		);
	}

	private createExpr(cond: LeafCondition): Record<string, unknown> {
		if (isRawCondition(cond)) return rawMongoFilter(cond.raw);
		const operator = effectiveOperator(cond);
		// ponytail: both of these need $expr on Mongo, which the rest of this
		// builder isn't shaped for. Rejected loudly rather than silently matching
		// the literal string "email". Wire $expr here when a graph needs it.
		if (!isValueless(operator) && isColumnRef(cond.value))
			throw new Error("column references in conditions are not supported on MongoDB");
		if (isLiteralRef(cond.attribute))
			throw new Error("literal attributes in conditions are not supported on MongoDB");

		// a tagged column means exactly what the untagged string does here
		const attribute = isColumnRef(cond.attribute) ? cond.attribute.value : cond.attribute;

		// "items[0].name" -> "items.0.name"; "id" stays the _id alias.
		const attr = attribute === "id" ? "_id" : toMongoField(attribute);

		// always an explicit operator: a bare { [attr]: val } lets a value like
		// { $ne: null } from the request body act as a query and match everything
		return { [attr]: this.matchFor(attr, operator, cond) };
	}

	private matchFor(
		attr: string,
		operator: DbOperator,
		cond: Exclude<LeafCondition, { operator: "raw" }>,
	): Record<string, unknown> {
		switch (operator) {
			// { $eq: null } also matches a missing field, like SQL's NULL; exists is the strict check
			case "is_null":
				return { $eq: null };
			case "is_not_null":
				return { $ne: null };
			case "exists":
				return { $exists: true };
			case "not_exists":
				return { $exists: false };
			case "in":
			case "not_in": {
				// as typed, like eq: "7" does not match the number 7
				const list = listValue(conditionValue(cond), operator).map((v) => this.idValue(attr, v));
				if (operator === "in") return { $in: list };
				// $nin alone also matches null and missing fields; SQL's NOT IN never
				// matches NULL, and one graph must answer the same on every database
				return { $nin: list, $ne: null };
			}
			case "between": {
				const [min, max] = rangeValue(conditionValue(cond)).map(numericIntent);
				return { $gte: min, $lte: max };
			}
			case "contains":
			case "starts_with":
			case "ends_with":
				return {
					$regex: regexPattern(operator, textValue(conditionValue(cond), operator)),
					$options: "i",
				};
			default: {
				// Ordering ops carry numeric intent; eq/neq stay as typed so
				// string-field equality keeps working.
				// ponytail: only ordering ops coerce — flip eq/neq here if a numeric
				// field is ever queried for equality with a string value.
				const val = isLiteralRef(cond.value) ? cond.value.value : cond.value;
				const typed = operator === "eq" || operator === "neq" ? val : numericIntent(val);
				return { [this.getMongoOperator(operator)]: this.idValue(attr, typed) };
			}
		}
	}

	/** a 24-char hex string compared against _id is an ObjectId */
	private idValue(attr: string, val: unknown) {
		if (attr !== "_id" || typeof val !== "string" || val.length !== 24) return val;
		try {
			// Official v6+ pattern for safely converting 24-char hex strings
			return ObjectId.createFromHexString(val);
		} catch {
			return val;
		}
	}

	private getMongoOperator(operator: string): string {
		const map: Record<string, string> = {
			eq: "$eq",
			neq: "$ne",
			gt: "$gt",
			gte: "$gte",
			lt: "$lt",
			lte: "$lte",
		};
		return map[operator] ?? "$eq";
	}
}

/** a numeric-like string compared by order means a number, so BSON doesn't compare it as text */
const numericIntent = (val: unknown) =>
	typeof val === "string" && isNumericLike(val) ? Number(val) : val;

/** a standalone mongod refuses any transaction with IllegalOperation (code 20) */
export function isTransactionUnsupported(error: unknown): boolean {
	return (
		(error as { code?: number })?.code === 20 &&
		/Transaction numbers are only allowed/i.test(String((error as Error).message))
	);
}

function mongoTypeOf(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (value instanceof ObjectId) return "objectId";
	if (value instanceof Date) return "date";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

export function buildMongoUrl(connection: Connection): string {
	const { username, password, host, port, database } = connection;
	if (!username) return `mongodb://${host}:${port}/${database}?directConnection=true`;
	return `mongodb://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}?directConnection=true`;
}

export function extractMongoConnectionInfo(
	config: Record<string, unknown>,
	appConfigs: Map<string, string>,
	mongoUrlParser: (url: string) => Connection | null,
) {
	if (config.source === "url") {
		let urlStr = String(config.url);
		urlStr = urlStr.startsWith("cfg:") ? (appConfigs.get(urlStr.slice(4)) ?? "") : urlStr;
		const result = mongoUrlParser(urlStr);
		if (result === null) return null;
		return {
			host: result.host,
			port: result.port,
			database: result.database,
			username: result.username,
			password: result.password,
			dbType: result.dbType,
		};
	}

	for (const key in config) {
		const value = String(config[key]);
		config[key] = value.startsWith("cfg:") ? (appConfigs.get(value.slice(4)) ?? "") : value;
	}
	return config;
}
