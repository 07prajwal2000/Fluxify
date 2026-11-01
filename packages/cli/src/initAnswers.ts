import { EXACT_VERSION, fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { z } from "zod";
import { fail } from "./fail";

export type Ask = (question: string) => Promise<string>;

export const DEFAULT_VERSION = "0.1.0";

export type Answers = { name: string; url: string; version: string; description: string };

type Given = Partial<Answers> & {
	/** `--yes`: never ask, take the default of everything not given */
	yes?: boolean;
	ask?: Ask;
};

const { shape } = fluxifyManifestSchema;
const version = z.string().regex(EXACT_VERSION, "must be a version like 1.2.3");
/** how many wrong answers one question gets before init gives up */
const TRIES = 3;

type Field = {
	key: keyof Answers;
	flag: string;
	question: string;
	schema: z.ZodType<string>;
	/** absent: the answer is required */
	fallback?: string;
};

const FIELDS: Field[] = [
	{
		key: "name",
		flag: "--name",
		question: "Plugin name (scope/name, e.g. acme/slack)",
		schema: shape.name,
	},
	{ key: "url", flag: "--url", question: "Docs or source URL (https://...)", schema: shape.url },
	{
		key: "version",
		flag: "--version",
		question: "Version",
		schema: version,
		fallback: DEFAULT_VERSION,
	},
	{
		key: "description",
		flag: "--description",
		question: "Description",
		schema: z.string(),
		fallback: "",
	},
];

/**
 * What the new plugin is called and says about itself. With no flag at all and a
 * terminal, every field is asked one by one (Enter takes the default of an
 * optional one). Once any flag is given, or with `--yes`, only a missing
 * name or url is asked for, and an optional field takes its default.
 */
export async function initAnswers(given: Given): Promise<Answers> {
	const interactive = !given.yes && !FIELDS.some((f) => given[f.key] !== undefined);
	const answers = {} as Answers;
	for (const f of FIELDS) {
		const check = (value: string) => f.schema.safeParse(value);
		const flagged = given[f.key];
		if (flagged !== undefined) {
			const parsed = check(flagged);
			answers[f.key] = parsed.success
				? parsed.data
				: fail(`${f.flag} '${flagged}': ${parsed.error.issues[0].message}`);
			continue;
		}
		const ask =
			given.ask && !given.yes && (interactive || f.fallback === undefined) ? given.ask : undefined;
		if (!ask) {
			answers[f.key] = f.fallback ?? fail(`${f.flag} is required: ${f.question}`);
			continue;
		}
		const label = f.fallback ? `${f.question} (${f.fallback})` : f.question;
		for (let tried = 1; ; tried++) {
			const typed = (await ask(label)).trim();
			const value = typed || f.fallback;
			const parsed = value === undefined ? undefined : check(value);
			if (parsed?.success) {
				answers[f.key] = parsed.data;
				break;
			}
			const why = parsed ? parsed.error.issues[0].message : "is required";
			if (tried === TRIES) fail(`${f.flag} ${why}`);
			console.error(`  ${f.key} ${why}`);
		}
	}
	return answers;
}
