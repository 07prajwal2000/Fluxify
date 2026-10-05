import type { DbOperator } from "@fluxify/lib";
import { type ClientSession, type Collection, ObjectId } from "mongodb";
import type { DBConditionType } from ".";
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

/**
 * What a collection's newest documents hold (#511): each field's stored
 * types, and whether documents carry their own `id` field, in which case `id`
 * means that field instead of `_id`.
 */
export type MongoShape = { ownId: boolean; types: Map<string, Set<string>> };

// ponytail: 5 documents, top-level fields; a field only older documents hold reads as untyped
export async function sampleShape(
	collection: Collection,
	session?: ClientSession,
): Promise<MongoShape> {
	const docs = await collection.find({}, { session, sort: { _id: -1 }, limit: 5 }).toArray();
	const types = new Map<string, Set<string>>();
	for (const doc of docs) {
		for (const [key, value] of Object.entries(doc)) {
			if (!types.has(key)) types.set(key, new Set());
			types.get(key)!.add(mongoTypeOf(value));
		}
	}
	return { ownId: types.has("id"), types };
}

export function mongoTypeOf(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (value instanceof ObjectId) return "objectId";
	if (value instanceof Date) return "date";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

/** `id` is the `_id` alias unless documents have their own `id`; "items[0].name" -> "items.0.name" */
export const mongoField = (attribute: string, shape: MongoShape) =>
	attribute === "id" && !shape.ownId ? "_id" : toMongoField(attribute);

const HEX_ID = /^[0-9a-f]{24}$/i;

/** every stored value is an ObjectId (or empty) */
function holdsObjectIds(shape: MongoShape, field: string) {
	const kinds = shape.types.get(field);
	return !!kinds?.has("objectId") && [...kinds].every((k) => k === "objectId" || k === "null");
}

function notAnObjectId(name: string, value: string) {
	return new Error(`${name} holds ObjectIds: "${value}" is not one (24 hex characters)`);
}

/**
 * The values a string stands for on `field`: an ObjectId where the field holds
 * ObjectIds, both forms where it may hold either, else the string alone. A
 * string that can't be an ObjectId on an ObjectId field fails instead of
 * matching nothing.
 */
export function idForms(shape: MongoShape, field: string, name: string, value: unknown): unknown[] {
	if (typeof value !== "string") return [value];
	const hex = HEX_ID.test(value);
	if (holdsObjectIds(shape, field)) {
		if (!hex) throw notAnObjectId(name, value);
		return [ObjectId.createFromHexString(value)];
	}
	return hex ? [value, ObjectId.createFromHexString(value)] : [value];
}

/** a document to write, with id strings stored as ObjectIds on fields that hold them */
export function storedDoc(data: Record<string, unknown>, shape: MongoShape) {
	return Object.fromEntries(
		Object.entries(data).map(([key, value]) => {
			if (typeof value !== "string" || !holdsObjectIds(shape, key)) return [key, value];
			if (!HEX_ID.test(value)) throw notAnObjectId(key, value);
			return [key, ObjectId.createFromHexString(value)];
		}),
	);
}

export function mongoFilter(
	conditions: DBConditionType[],
	shape: MongoShape,
): Record<string, unknown> {
	const active = activeConditions(conditions);
	if (active.length === 0) return {};

	return foldConditions<Record<string, unknown>>(
		active,
		(cond) => createExpr(cond, shape),
		(chain, left, right) => ({ [chain === "or" ? "$or" : "$and"]: [left, right] }),
	);
}

function createExpr(cond: LeafCondition, shape: MongoShape): Record<string, unknown> {
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
	const field = mongoField(attribute, shape);
	const forms = (value: unknown) => idForms(shape, field, attribute, value);

	// always an explicit operator: a bare { [field]: val } lets a value like
	// { $ne: null } from the request body act as a query and match everything
	return { [field]: matchFor(operator, cond, forms) };
}

function matchFor(
	operator: DbOperator,
	cond: Exclude<LeafCondition, { operator: "raw" }>,
	forms: (value: unknown) => unknown[],
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
			const list = listValue(conditionValue(cond), operator).flatMap(forms);
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
			const val = isLiteralRef(cond.value) ? cond.value.value : cond.value;
			// eq/neq stay as typed so string-field equality keeps working; an id
			// string may stand for two values, matched as either
			if (operator === "eq" || operator === "neq") {
				const all = forms(val);
				if (all.length > 1) return { [operator === "eq" ? "$in" : "$nin"]: all };
				return { [MONGO_OPERATORS[operator]]: all[0] };
			}
			// Ordering ops carry numeric intent.
			// ponytail: only ordering ops coerce — flip eq/neq here if a numeric
			// field is ever queried for equality with a string value.
			return { [MONGO_OPERATORS[operator] ?? "$eq"]: forms(numericIntent(val))[0] };
		}
	}
}

const MONGO_OPERATORS: Record<string, string> = {
	eq: "$eq",
	neq: "$ne",
	gt: "$gt",
	gte: "$gte",
	lt: "$lt",
	lte: "$lte",
};

/** a numeric-like string compared by order means a number, so BSON doesn't compare it as text */
const numericIntent = (val: unknown) =>
	typeof val === "string" && isNumericLike(val) ? Number(val) : val;
