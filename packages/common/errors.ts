/**
 * A value the running environment has none of (#733): an integration or an app
 * config key with no development value and no "Same as production". Blocks let
 * it through unwrapped, so the response and the logs say which one is missing
 * instead of "failed to execute get all db block".
 */
export class MissingEnvValueError extends Error {
	override readonly name = "MissingEnvValueError";
}
