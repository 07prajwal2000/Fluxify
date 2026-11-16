// Shared by the rollback container tests (#1130): a stack with the backups router,
// an archive of a project as it is now, and the rollback endpoints over HTTP.
import { spyOn } from "bun:test";
import { createStack, type Stack } from "../../../../modules/deployments/tests/blockHarness";

export type As = { user: string; project: string; role?: string };

export async function rollbackStack(prefix: string) {
	const stack = await createStack(prefix);
	(await import("../register")).default.registerHandler(stack.app);
	// the compiler is not listening here: the tests compile by hand
	const publisher = await import("../../../../modules/compiler/publisher");
	spyOn(publisher, "requestProjectCompile").mockResolvedValue(true);
	const { createBackup } = await import("../../../../modules/projectBackup/backup");
	const { BACKUP_MODULES } = await import("../../../../modules/projectBackup/modules");
	const { readBackup } = await import("../../../../modules/projectBackup/restore");
	const ALL = BACKUP_MODULES.map((m) => m.name);

	/** a backup of the project as it is now, every section unless told */
	const archive = async (
		project: string,
		{ sections = ALL, values = false }: { sections?: string[]; values?: boolean } = {},
	) =>
		(
			await createBackup(
				{
					projectId: project,
					source: { name: project, slug: project },
					mode: "backup",
					sections,
					options: { includeVersionHistory: false, includeAppConfigValues: values },
				},
				BACKUP_MODULES,
			)
		).bytes;

	const headers = (as: As) => ({
		"X-User": as.user,
		"X-Project": as.project,
		"X-Role": as.role ?? "creator",
	});

	/** a multipart POST, as the portal sends the file */
	async function upload(as: As, path: string, bytes: Uint8Array, fields: Record<string, string> = {}) {
		const form = new FormData();
		form.set("file", new File([bytes as Uint8Array<ArrayBuffer>], "backup.tar.gz"));
		for (const [k, v] of Object.entries(fields)) form.set(k, v);
		const res = await stack.app.request(`http://localhost/${as.project}/backups/${path}`, {
			method: "POST",
			headers: headers(as),
			body: form,
		});
		return { status: res.status, body: (await res.json()) as any };
	}

	const inspect = (as: As, bytes: Uint8Array) => upload(as, "rollback/inspect", bytes);
	const rollback = (
		as: As,
		bytes: Uint8Array,
		mode: "keep" | "exact",
		sections: string[] = ALL,
		restoreSecrets = false,
	) =>
		upload(as, "rollback", bytes, {
			mode,
			sections: sections.join(","),
			restoreSecrets: String(restoreSecrets),
		});

	/** what a section of an archive holds, parsed */
	const sectionOf = async (bytes: Uint8Array, name: string) =>
		(await readBackup(bytes, BACKUP_MODULES)).sections.find((s) => s.module.name === name)
			?.data as any;

	/** the history rows of the project, newest first */
	const history = async (as: As) =>
		(await stack.call(as, "GET", `/${as.project}/backups`)).body.backups as any[];

	return { stack, ALL, archive, inspect, rollback, sectionOf, history, BACKUP_MODULES };
}

/** the script of a canvas's JS block: in the working copy, or in a stored snapshot */
export const scriptOf = (canvas: { blocks: { type: string; data: any }[] }) =>
	canvas.blocks.find((b) => b.type === "jsrunner")?.data?.value as string | undefined;

/** the snapshot production serves for a route or workflow */
export async function prodSnapshot(stack: Stack, table: "routes" | "workflows", id: string) {
	const [row] = await stack.sql.unsafe(
		`SELECT v.snapshot FROM ${table} t JOIN canvas_versions v ON v.id = t.prod_version_id WHERE t.id = $1`,
		[id],
	);
	return row?.snapshot as { blocks: { type: string; data: any }[] } | undefined;
}
