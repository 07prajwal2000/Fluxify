/**
 * JSON has no BigInt type: DB drivers return bigint columns as BigInt, and
 * JSON.stringify (Hono's c.json, a queue payload, a logged value) throws on one.
 * Serialized as a string, so values above Number.MAX_SAFE_INTEGER keep their
 * digits.
 *
 * Imported for its side effect by every process entry, the execution and test
 * children included: they are separate processes, and a patch applied in the
 * supervisor does not reach the code they run.
 *
 * ponytail: global prototype patch, the standard bigint-serialization fix
 */
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) {
	return this.toString();
};
