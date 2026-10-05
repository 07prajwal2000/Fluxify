import { type ClientSession, type Db, MongoClient } from "mongodb";
import {
	type Connection,
	changedRows,
	type DBConditionType,
	DbAdapterMode,
	type IDbAdapter,
	type IntrospectedTable,
	type IsolationLevel,
	type OnConflict,
	type QueryOptions,
	type WriteResult,
} from ".";
import { mongoCounterUpdate } from "./counter";
import { type DbCursor, type DbPage, mongoPage } from "./cursor";
import {
	type MongoShape,
	mongoField,
	mongoFilter,
	mongoTypeOf,
	sampleShape,
	storedDoc,
} from "./mongoFilter";
import { activeSorts, type DbSort, mongoSorts, singleRow, sortSpec } from "./sort";
import { isTransactionUnsupported, standaloneWarning } from "./transactionErrors";
import { mongoUpsertOps } from "./upsert";
import { plainNumbers } from "./values";

export class MongoAdapter implements IDbAdapter {
	public static variant = "MongoDB";
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;

	private session: ClientSession | null = null;
	/** per collection, sampled once: adapters live for one request */
	private readonly shapes = new Map<string, Promise<MongoShape>>();

	constructor(
		private readonly client: MongoClient,
		private readonly db: Db,
	) {}

	public static async testConnection(
		connection: Connection,
	): Promise<{ success: boolean; error?: unknown; warning?: string }> {
		let tempClient: MongoClient | null = null;
		try {
			tempClient = new MongoClient(buildMongoUrl(connection), {
				serverSelectionTimeoutMS: 2000,
			});
			await tempClient.connect();
			const hello = await tempClient.db("admin").command({ hello: 1 });
			return { success: true, warning: standaloneWarning(hello) };
		} catch (error) {
			return { success: false, error };
		} finally {
			if (tempClient) await tempClient.close();
		}
	}

	async raw(): Promise<Db> {
		return this.db;
	}

	/** the open transaction's session, which native code's collection calls carry (#514) */
	transactionSession(): ClientSession | undefined {
		return this.getOptions().session;
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
		limit: number | null,
		offset: number = 0,
		sort: DbSort[] = [],
		options?: QueryOptions,
	): Promise<unknown[]> {
		const shape = await this.shape(table);
		const found = this.db
			.collection(table)
			.find(mongoFilter(conditions, shape), this.findOptions(shape, options))
			.sort(sortSpec(mongoSorts(sort, [], shape.ownId)))
			.skip(offset);
		const docs = await (limit === null ? found : found.limit(limit)).toArray();
		return docs.map(this.mapDoc);
	}

	async getPage(
		table: string,
		conditions: DBConditionType[],
		limit: number | null,
		sort: DbSort[],
		cursor: DbCursor,
		options?: QueryOptions,
	): Promise<DbPage> {
		const shape = await this.shape(table);
		const page = await mongoPage(
			this.db.collection(table),
			mongoFilter(conditions, shape),
			this.findOptions(shape, options),
			mongoSorts(sort, cursor.keys, shape.ownId),
			limit,
			cursor.after,
		);
		return { rows: page.rows.map(this.mapDoc), nextCursor: page.nextCursor };
	}

	async getSingle(
		table: string,
		conditions: DBConditionType[],
		options?: QueryOptions,
	): Promise<unknown | null> {
		const shape = await this.shape(table);
		const filter = mongoFilter(conditions, shape);
		// unsorted stays unsorted: a sort nobody asked for only costs time
		const sort = activeSorts(options?.sort).length
			? sortSpec(mongoSorts(options?.sort ?? [], [], shape.ownId))
			: undefined;
		// strict reads a second document only to tell that there is one
		const docs = await this.db
			.collection(table)
			.find(filter, { ...this.findOptions(shape, options), ...(sort && { sort }) })
			.limit(options?.strict ? 2 : 1)
			.toArray();
		return this.mapDoc(singleRow(docs, options?.strict));
	}

	async count(table: string, conditions: DBConditionType[]): Promise<number> {
		const filter = mongoFilter(conditions, await this.shape(table));
		return this.db.collection(table).countDocuments(filter, this.getOptions());
	}

	async delete(table: string, conditions: DBConditionType[]): Promise<WriteResult> {
		const { docs, byId } = await this.findMatching(table, conditions);
		const { deletedCount } = await this.db.collection(table).deleteMany(byId, this.getOptions());
		return { count: deletedCount, affected: docs.map(this.mapDoc) };
	}

	/** the documents the conditions match, and a filter for exactly those */
	private async findMatching(table: string, conditions: DBConditionType[]) {
		const filter = mongoFilter(conditions, await this.shape(table));
		const docs = await this.db.collection(table).find(filter, this.getOptions()).toArray();
		return { docs, byId: { _id: { $in: docs.map((d) => d._id) } } };
	}

	async insert(table: string, data: unknown, onConflict?: OnConflict): Promise<unknown> {
		if (onConflict) {
			const [doc] = await this.upsert(
				table,
				[data as Record<string, unknown>],
				onConflict,
				this.getOptions(),
			);
			return doc ?? null;
		}
		const cleanData = await this.writable(table, data as Record<string, unknown>);
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
		onConflict?: OnConflict,
	): Promise<unknown[]> {
		if (!data || data.length === 0) return [];

		const cleanData = await Promise.all(data.map((d) => this.writable(table, d)));

		const insertAll = async (options: { session?: ClientSession }) => {
			if (onConflict) return this.upsert(table, data, onConflict, options);
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

	/**
	 * One upsert per row, matched on `target`: `$set` the update columns, `$setOnInsert` the rest.
	 * Without a unique index on `target`, two requests at once can both insert.
	 */
	private async upsert(
		table: string,
		rows: Record<string, unknown>[],
		onConflict: OnConflict,
		options: { session?: ClientSession },
	): Promise<unknown[]> {
		const shape = await this.shape(table);
		const stored = rows.map((row) => storedDoc(row, shape));
		const { filters, ops } = mongoUpsertOps(stored, onConflict, shape.ownId);
		const collection = this.db.collection(table);
		const result = await collection.bulkWrite(ops, options);
		// ignore returns only what it inserted
		const filter =
			onConflict.action === "ignore"
				? { _id: { $in: Object.values(result.upsertedIds) } }
				: { $or: filters };
		const docs = await collection.find(filter, options).toArray();
		return docs.map(this.mapDoc);
	}

	async update(table: string, data: unknown, conditions: DBConditionType[]): Promise<WriteResult> {
		const { docs: before, byId } = await this.findMatching(table, conditions);
		if (before.length === 0) return { count: 0, affected: [] };

		const cleanData = await this.writable(table, data as Record<string, unknown>);
		const collection = this.db.collection(table);
		const update = mongoCounterUpdate(cleanData);
		const { modifiedCount } = await collection.updateMany(byId, update, this.getOptions());

		const keyOf = (d: { _id: unknown }) => String(d._id);
		const after = await collection.find(byId, this.getOptions()).toArray();
		const was = new Map(before.map((d) => [keyOf(d), d]));
		return { count: modifiedCount, affected: changedRows(was, after, keyOf).map(this.mapDoc) };
	}

	async setMode(mode: DbAdapterMode): Promise<void> {
		this.mode = mode;
	}

	async startTransaction(isolation?: IsolationLevel): Promise<void> {
		if (this.mode === DbAdapterMode.TRANSACTION) return;
		if (isolation) throw new Error("MongoDB transactions have no isolation level to choose");

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
	private findOptions(shape: MongoShape, options?: QueryOptions) {
		const base = this.getOptions();
		const cols = options?.columns;
		if (!cols || cols.length === 0 || cols.some((c) => c.includes("*"))) return base;

		const projection: Record<string, 1> = {};
		for (const raw of cols) {
			const expr = raw.split(/\s+as\s+/i)[0].trim();
			projection[mongoField(expr, shape)] = 1;
		}
		return { ...base, projection };
	}

	private shape(table: string): Promise<MongoShape> {
		let shape = this.shapes.get(table);
		if (!shape) {
			shape = sampleShape(this.db.collection(table), this.getOptions().session);
			this.shapes.set(table, shape);
		}
		return shape;
	}

	/** data to write: never `_id`, `id` only when documents have their own, id strings as ObjectIds */
	private async writable(table: string, data: Record<string, unknown>) {
		const shape = await this.shape(table);
		const { id, _id, ...rest } = data;
		return storedDoc(shape.ownId && "id" in data ? { id, ...rest } : rest, shape);
	}

	// Arrow function preserves 'this' context when used in array mappings.
	// A document with its own `id` keeps it, and its _id comes back as `_id` (#511).
	private mapDoc = (doc: Record<string, unknown> | null) => {
		if (!doc) return null;
		const { _id, ...rest } = doc;
		const key = "id" in rest ? "_id" : "id";
		return { [key]: _id ? String(_id) : undefined, ...(plainNumbers(rest) as object) };
	};
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
