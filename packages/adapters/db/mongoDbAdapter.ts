import { MongoClient, Db, ClientSession, ObjectId } from "mongodb";
import { Connection, DbAdapterMode, DBConditionType, IDbAdapter } from ".";
import { JsVM } from "@fluxify/lib";

export class MongoAdapter implements IDbAdapter {
	private mode: DbAdapterMode = DbAdapterMode.NORMAL;
	private readonly HARD_LIMIT = 1000;

	private session: ClientSession | null = null;

	constructor(
		private readonly client: MongoClient,
		private readonly db: Db,
		private readonly vm: JsVM,
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

	async raw(query: string | unknown, params?: unknown[]): Promise<unknown> {
		if (typeof query !== "object" || query === null) {
			throw new Error("raw() for MongoDB expects a command object.");
		}
		return this.db.command(query as Record<string, unknown>, this.getOptions());
	}

	async getAll(
		table: string,
		conditions: DBConditionType[],
		limit: number = this.HARD_LIMIT,
		offset: number = 0,
		sort: { attribute: string; direction: "asc" | "desc" },
	): Promise<unknown[]> {
		const filter = this.buildFilter(conditions);
		const l = limit < 0 || limit > this.HARD_LIMIT ? this.HARD_LIMIT : limit;

		const sortAttr = sort.attribute === "id" ? "_id" : sort.attribute;
		const sortDef = { [sortAttr]: sort.direction === "asc" ? 1 : -1 };

		const docs = await this.db
			.collection(table)
			.find(filter, this.getOptions())
			.sort(sortDef as Record<string, 1 | -1>)
			.skip(offset)
			.limit(l)
			.toArray();

		return docs.map(this.mapDoc);
	}

	async getSingle(
		table: string,
		conditions: DBConditionType[],
	): Promise<unknown | null> {
		const filter = this.buildFilter(conditions);
		const doc = await this.db
			.collection(table)
			.findOne(filter, this.getOptions());
		return this.mapDoc(doc);
	}

	async delete(table: string, conditions: DBConditionType[]): Promise<boolean> {
		const filter = this.buildFilter(conditions);
		const result = await this.db
			.collection(table)
			.deleteMany(filter, this.getOptions());
		return result.deletedCount > 0;
	}

	async insert(
		table: string,
		data: unknown,
		pkColumn: string = "id",
	): Promise<unknown> {
		const cleanData = { ...(data as Record<string, unknown>) };
		delete cleanData.id;
		delete cleanData._id;

		const result = await this.db
			.collection(table)
			.insertOne(cleanData, this.getOptions());
		const doc = await this.db
			.collection(table)
			.findOne({ _id: result.insertedId }, this.getOptions());

		return this.mapDoc(doc);
	}

	async insertBulk(
		table: string,
		data: Record<string, unknown>[],
		pkColumn: string = "id",
	): Promise<unknown[]> {
		if (!data || data.length === 0) return [];

		const cleanData = data.map((d) => {
			const { id, _id, ...rest } = d;
			return rest;
		});

		const result = await this.db
			.collection(table)
			.insertMany(cleanData, this.getOptions());
		const ids = Object.values(result.insertedIds);

		const docs = await this.db
			.collection(table)
			.find({ _id: { $in: ids } }, this.getOptions())
			.toArray();

		return docs.map(this.mapDoc);
	}

	async update(
		table: string,
		data: unknown,
		conditions: DBConditionType[],
		pkColumn: string = "id",
	): Promise<unknown[]> {
		const filter = this.buildFilter(conditions);

		const docsToUpdate = await this.db
			.collection(table)
			.find(filter, this.getOptions())
			.toArray();
		const ids = docsToUpdate.map((d) => d._id);

		if (ids.length > 0) {
			const cleanData = { ...(data as Record<string, unknown>) };
			delete cleanData.id;
			delete cleanData._id;

			await this.db
				.collection(table)
				.updateMany(
					{ _id: { $in: ids } },
					{ $set: cleanData },
					this.getOptions(),
				);
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
		return this.mode === DbAdapterMode.TRANSACTION && this.session
			? { session: this.session }
			: {};
	}

	// Arrow function preserves 'this' context when used in array mappings
	private mapDoc = (doc: Record<string, unknown> | null) => {
		if (!doc) return null;
		const { _id, ...rest } = doc;
		return { id: _id ? String(_id) : undefined, ...rest };
	};

	private buildFilter(conditions: DBConditionType[]): Record<string, unknown> {
		if (!conditions || conditions.length === 0) return {};

		let filter: Record<string, unknown> = this.createExpr(conditions[0]);

		for (let i = 1; i < conditions.length; i++) {
			const cond = conditions[i];
			const expr = this.createExpr(cond);

			if (cond.chain.toLowerCase() === "or") {
				filter = { $or: [filter, expr] };
			} else {
				filter = { $and: [filter, expr] };
			}
		}

		return filter;
	}

	private createExpr(cond: DBConditionType): Record<string, unknown> {
		const attr = cond.attribute === "id" ? "_id" : cond.attribute;

		// Explicitly typing as 'unknown' allows us to safely overwrite
		// the primitive value with a MongoDB ObjectId class instance.
		let val: unknown = cond.value;

		if (attr === "_id" && typeof val === "string" && val.length === 24) {
			try {
				// Official v6+ pattern for safely converting 24-char hex strings
				val = ObjectId.createFromHexString(val);
			} catch (e) {}
		}

		const op = this.getMongoOperator(cond.operator);

		// MongoDB natively prefers { _id: ObjectId() } instead of { _id: { $eq: ObjectId() } }
		if (op === "$eq") {
			return { [attr]: val };
		}

		return { [attr]: { [op]: val } };
	}

	private getMongoOperator(
		operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
	): string {
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

export function buildMongoUrl(connection: Connection): string {
	const { username, password, host, port, database } = connection;
	if (!username)
		return `mongodb://${host}:${port}/${database}?directConnection=true`;
	return `mongodb://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}?directConnection=true`;
}

export function extractMongoConnectionInfo(
	config: Record<string, unknown>,
	appConfigs: Map<string, string>,
	mongoUrlParser: (url: string) => Connection | null,
) {
	if (config.source === "url") {
		let urlStr = String(config.url);
		urlStr = urlStr.startsWith("cfg:")
			? (appConfigs.get(urlStr.slice(4)) ?? "")
			: urlStr;
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
		config[key] = value.startsWith("cfg:")
			? (appConfigs.get(value.slice(4)) ?? "")
			: value;
	}
	return config;
}
