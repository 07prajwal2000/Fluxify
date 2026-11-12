import { spyOn } from "bun:test";
import { z } from "zod";
import type { DbTransactionType } from "../../../db";
import { EncryptionService } from "../../../lib/encryption";
import { type Payload, writeArchive } from "../archive";
import { orderModules } from "../registry";
import { type OpenProject, readBackup, restoreBackup } from "../restore";
import type { BackupMode, BackupModule } from "../types";

/**
 * Two stand-in resources over an in-memory "database": `tags`, and `notes`,
 * which depend on tags by name and carry a secret and an attachment file.
 * `notes` is at format v3; v1 was `{ notes: string[] }`, v2 added `tag`, v3
 * added `secret`.
 */
export type Project = {
	tags: { id: string; name: string; color: string }[];
	notes: { id: string; title: string; tagId: string | null; secret: string }[];
	attachments: Record<string, string>;
};

export const store = new Map<string, Project>();
/** the order modules imported in, for the dependency-order test */
export const importLog: string[] = [];

const empty = (): Project => ({ tags: [], notes: [], attachments: {} });
/** the fake transaction is the draft project itself; `openProject` commits it on success */
const draft = (tx: DbTransactionType) => tx as unknown as Project;
const enc = new TextEncoder();

export const tags: BackupModule<{ tags: { name: string; color: string }[] }> = {
	name: "tags",
	version: 1,
	minSupported: 1,
	dependsOn: [],
	schema: z.object({ tags: z.array(z.object({ name: z.string(), color: z.string() })) }),
	upgrades: {},
	async export({ projectId }) {
		return { data: { tags: store.get(projectId)!.tags.map(({ name, color }) => ({ name, color })) } };
	},
	async import(ctx, data) {
		importLog.push("tags");
		for (const tag of data.tags) {
			const id = crypto.randomUUID();
			draft(ctx.tx).tags.push({ id, ...tag });
			ctx.ids.set("tags", tag.name, id);
		}
	},
};

const noteSchema = z.object({ title: z.string(), tag: z.string().nullable(), secret: z.string() });

export const notes: BackupModule<{ notes: z.infer<typeof noteSchema>[] }> = {
	name: "notes",
	version: 3,
	minSupported: 1,
	dependsOn: ["tags"],
	schema: z.object({ notes: z.array(noteSchema) }),
	upgrades: {
		1: (data) => ({
			notes: (data as { notes: string[] }).notes.map((title) => ({ title, tag: null })),
		}),
		2: (data) => ({
			notes: (data as { notes: object[] }).notes.map((note) => ({ ...note, secret: "" })),
		}),
	},
	async export({ projectId, mode }) {
		const project = store.get(projectId)!;
		const tagName = (id: string | null) => project.tags.find((t) => t.id === id)?.name ?? null;
		const files = Object.fromEntries(
			Object.entries(project.attachments).map(([path, text]) => [path, enc.encode(text)]),
		);
		const data = project.notes.map((n) => ({
			title: n.title,
			tag: tagName(n.tagId),
			secret: mode === "template" ? "" : n.secret,
		}));
		return { data: { notes: data }, files };
	},
	async import(ctx, data) {
		importLog.push("notes");
		const project = draft(ctx.tx);
		for (const note of data.notes)
			project.notes.push({
				id: crypto.randomUUID(),
				title: note.title,
				tagId: note.tag ? (ctx.ids.get("tags", note.tag) ?? null) : null,
				secret: note.secret,
			});
		for (const [path, bytes] of Object.entries(ctx.files))
			project.attachments[path] = new TextDecoder().decode(bytes);
	},
};

/** listed dependent-first on purpose: the registry has to reorder them */
export const STUBS = orderModules([notes, tags]);

export const openProject: OpenProject = async (work) => {
	const id = crypto.randomUUID();
	const project = empty();
	await work(project as unknown as DbTransactionType, id);
	store.set(id, project);
	return id;
};

export async function restore(tgz: Uint8Array, modules: BackupModule[] = STUBS) {
	return restoreBackup(await readBackup(tgz, modules), openProject);
}

/** a project with two tags and two notes, one tagged and one not */
export function seedProject(): string {
	const id = crypto.randomUUID();
	store.set(id, {
		tags: [
			{ id: "t1", name: "red", color: "#f00" },
			{ id: "t2", name: "blue", color: "#00f" },
		],
		notes: [
			{ id: "n1", title: "first", tagId: "t2", secret: "s3cret" },
			{ id: "n2", title: "second", tagId: null, secret: "" },
		],
		attachments: { "first.txt": "hello", "deep/second.txt": "world" },
	});
	return id;
}

export const KEY = Buffer.alloc(32, 7);
export const OTHER_KEY = Buffer.alloc(32, 9);

/** MASTER_ENCRYPTION_KEY is read once per process, so tests swap the key under it */
export function setKey(key: Buffer) {
	// biome-ignore lint/suspicious/noExplicitAny: getMasterKey is private
	spyOn(EncryptionService as any, "getMasterKey").mockReturnValue(key);
}

/** an archive with these sections as given (version, data), for crafting old, new and odd ones */
export function archiveOf(
	sections: Record<string, [version: number, data: unknown]>,
	mode: BackupMode = "template",
	files: Record<string, string> = {},
) {
	const payload: Payload = new Map();
	for (const [name, [, data]] of Object.entries(sections))
		payload.set(`sections/${name}.json`, enc.encode(JSON.stringify(data)));
	for (const [path, text] of Object.entries(files)) payload.set(path, enc.encode(text));
	const versions = Object.fromEntries(Object.entries(sections).map(([n, [v]]) => [n, v]));
	return writeArchive(
		{
			mode,
			release: "test",
			createdAt: "2026-11-12T00:00:00.000Z",
			source: { name: "Fixture", slug: "fixture" },
			sections: versions,
		},
		payload,
	);
}

/** names instead of ids, so two copies of a project compare equal */
export function portable(id: string) {
	const p = store.get(id)!;
	const tagName = (tagId: string | null) => p.tags.find((t) => t.id === tagId)?.name ?? null;
	return {
		tags: p.tags.map(({ name, color }) => ({ name, color })),
		notes: p.notes.map((n) => ({ title: n.title, tag: tagName(n.tagId), secret: n.secret })),
		attachments: p.attachments,
	};
}
