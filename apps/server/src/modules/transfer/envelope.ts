import type { z } from "zod";
import { BadRequestError } from "../../errors/badRequestError";

/**
 * The wrapper every exported file shares: a `kind` that says what it is, a
 * `version` that is bumped when the shape changes, and when it was exported.
 * `migrations` are keyed by the version they upgrade *from*; never edit a released one.
 */
export type BundleSpec<B> = {
	kind: string;
	version: number;
	/** what the file holds, in the words of an error message: "route", "workflow" */
	label: string;
	schema: z.ZodType<B>;
	migrations?: Record<number, (bundle: Record<string, unknown>) => Record<string, unknown>>;
};

export const envelopeHeader = (spec: BundleSpec<unknown>) => ({
	kind: spec.kind,
	version: spec.version,
	exportedAt: new Date().toISOString(),
});

/** Walks an older bundle up to the current version; a newer one is refused, not guessed at. */
function migrate(raw: Record<string, unknown>, spec: BundleSpec<unknown>) {
	let current = raw;
	while ((current.version as number) < spec.version) {
		const upgrade = spec.migrations?.[current.version as number];
		if (!upgrade) break;
		current = upgrade(current);
	}
	return current;
}

/** Reads untrusted input into a bundle, or says why it is not one. */
export function parseEnvelope<B>(raw: unknown, spec: BundleSpec<B>): B {
	const doc = raw as Record<string, unknown> | null;
	if (!doc || typeof doc !== "object" || doc.kind !== spec.kind) {
		throw new BadRequestError(`That isn't a Fluxify ${spec.label} export.`);
	}
	if (typeof doc.version !== "number" || !Number.isInteger(doc.version)) {
		throw new BadRequestError(`This ${spec.label} export has no usable version.`);
	}
	if (doc.version > spec.version) {
		throw new BadRequestError(
			`This ${spec.label} was exported by a newer version of Fluxify (v${doc.version}). Update to import it.`,
		);
	}
	const parsed = spec.schema.safeParse(migrate(doc, spec));
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new BadRequestError(
			`This ${spec.label} export is invalid: ${issue.path.join(".")} ${issue.message}`,
		);
	}
	return parsed.data;
}
