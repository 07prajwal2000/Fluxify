import type { Params } from "../params.js";

const AsyncFunction = (async () => {}).constructor as new (
	...args: string[]
) => (input: unknown, params: undefined) => Promise<unknown>;

/**
 * A `js:` string run as the engine runs it: a function body with `input` (the
 * block's input) in scope, so it must `return`. The engine also has the run's
 * globals (`vars`, `cfg`, ...) in scope; a test has no run, so it has only `input`.
 */
async function evaluate(value: unknown, input: unknown): Promise<unknown> {
	if (typeof value === "string")
		return value.startsWith("js:")
			? new AsyncFunction("input", "params", value.slice(3))(input, undefined)
			: value;
	if (Array.isArray(value)) return Promise.all(value.map((item) => evaluate(item, input)));
	if (value && typeof value === "object")
		return Object.fromEntries(
			await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await evaluate(v, input)])),
		);
	return value;
}

/** a Transformer's field map applied to `input`; the engine emits the Transformer's own code for it */
const mapFields = (map: object, input: any) =>
	Object.fromEntries(Object.entries(map).map(([from, to]) => [to, input?.[from]]));

/**
 * The params as the engine hands them to the block: every `js:` string in
 * them evaluated against `input`, and each `fieldMap` applied to it. A
 * `schema` param stays as given: a test passes it compiled.
 */
export async function evaluateParams(
	params: Params,
	values: Record<string, unknown>,
	input: unknown,
) {
	const out: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(values)) {
		const type = Object.hasOwn(params, name) ? params[name]!.type : undefined;
		out[name] =
			type === "schema"
				? value
				: type === "fieldMap" && value && typeof value === "object" && !Array.isArray(value)
					? mapFields(value, input)
					: await evaluate(value, input);
	}
	return out;
}
