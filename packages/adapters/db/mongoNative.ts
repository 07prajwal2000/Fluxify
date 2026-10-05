import type { ClientSession, Collection, Db } from "mongodb";

/** where each Collection method takes its options, so the session can be added there */
const OPTIONS_AT: Record<string, number> = {
	find: 1,
	findOne: 1,
	aggregate: 1,
	countDocuments: 1,
	insertOne: 1,
	insertMany: 1,
	deleteOne: 1,
	deleteMany: 1,
	bulkWrite: 1,
	findOneAndDelete: 1,
	updateOne: 2,
	updateMany: 2,
	replaceOne: 2,
	findOneAndUpdate: 2,
	findOneAndReplace: 2,
	distinct: 2,
};

/** methods run on the real object: the driver keeps state that a proxy as `this` can't reach */
function wrap<T extends object>(
	target: T,
	call: (key: string, fn: (...args: any[]) => unknown, args: any[]) => unknown,
): T {
	return new Proxy(target, {
		get(t, key) {
			const value = Reflect.get(t, key, t);
			if (typeof value !== "function" || typeof key !== "string") return value;
			return (...args: any[]) => call(key, value.bind(t), args);
		},
	});
}

/**
 * The Db that native code gets on MongoDB. `session()` runs before every call: it
 * returns the transaction's session, which each collection read and write is
 * given (unless the caller passed its own), or throws to refuse the call (#514).
 * ponytail: Db-level calls (command, aggregate, createCollection) and index/admin
 * methods get no session; add them to OPTIONS_AT if they ever need to run in one.
 */
export function sessionBoundDb(db: Db, session: () => ClientSession | undefined): Db {
	return wrap(db, (key, fn, args) => {
		session();
		if (key !== "collection") return fn(...args);
		return wrap(fn(...args) as Collection, (method, call, callArgs) => {
			const live = session();
			const at = OPTIONS_AT[method];
			if (live && at !== undefined) callArgs[at] = { session: live, ...callArgs[at] };
			return call(...callArgs);
		});
	});
}

/** native code builds ids with it */
export { ObjectId } from "mongodb";
