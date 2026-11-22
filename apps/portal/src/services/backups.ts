import type {
	rollbackInspectResponseSchema,
	rollbackResponseSchema,
} from "@fluxify/server/src/api/v1/backups/dto";
import type z from "zod";
import type { ProjectForm } from "@/components/home/restore/NewProjectForm";
import { httpClient } from "@/lib/http";
import type { ArchiveSummary, RestoreResult } from "./projects";

export type BackupMode = "backup" | "template";

/** one row of a project's backup history (#1103); dates arrive as ISO strings */
export interface BackupRow {
	id: string;
	type: "manual" | "object_storage" | "git";
	mode: BackupMode;
	sections: string[];
	formatVersions: Record<string, number>;
	release: string | null;
	sizeBytes: number | null;
	status: "running" | "succeeded" | "failed";
	error: string | null;
	/** a finished manual archive that is still held */
	downloadable: boolean;
	expiresAt: string | null;
	/** the bucket key of an object storage backup, or the SHA of a git commit */
	destinationKey: string | null;
	/** why it was taken, e.g. "Before rollback" (#1130); null for one made by hand or on schedule */
	label: string | null;
	createdBy: { email: string; name: string | null } | null;
	createdAt: string;
	finishedAt: string | null;
}

export interface BackupSection {
	name: string;
	dependsOn: string[];
}

export interface StartBackupBody {
	mode: BackupMode;
	sections: string[];
	includeVersionHistory: boolean;
	includeAppConfigValues: boolean;
	readme?: string;
}

export type BackupInterval = "daily" | "weekly" | "monthly";

/** backups to object storage (#1106); the resources and options are shared with the manual form */
export interface BackupSchedule {
	integrationId: string | null;
	prefix: string;
	interval: BackupInterval;
	retention: number;
	enabled: boolean;
	sections: string[];
	includeVersionHistory: boolean;
	includeAppConfigValues: boolean;
}

export interface BackupScheduleView {
	schedule: BackupSchedule;
	/** what the prefix starts as: the project's slug */
	defaultPrefix: string;
	lastRun: BackupRow | null;
}

/** a backup in a bucket, from its `.meta.json` alone (#1107) */
export interface RemoteBackup {
	key: string;
	backupId: string;
	createdAt: string;
	mode: BackupMode;
	release: string;
	/** what the bucket holds */
	sizeBytes: number;
	source: { projectId: string; name: string; slug: string };
	/** section -> its format version */
	sections: Record<string, number>;
	hasReadme: boolean;
}

export type RemoteTarget = { integrationId: string; key: string };

/** commits to a git repository (#1150); username and token are typed in or `cfg:KEY`; a saved typed token reads "********" */
export interface GitSettings {
	url: string;
	branch: string;
	path: string;
	username: string;
	/** the commits' author email (#1153), typed or `cfg:KEY`; empty in settings saved before it was asked for */
	email: string;
	token: string;
	encryptSecrets: boolean;
}

export interface GitSettingsView {
	settings: GitSettings;
}

export interface GitCommit {
	sha: string;
	message: string;
	author: string;
	date: string;
}

/** rolling this project back in place (#1130) */
export type RollbackSummary = z.infer<typeof rollbackInspectResponseSchema>;
export type RollbackResult = z.infer<typeof rollbackResponseSchema>;
export type RollbackChoice = {
	mode: "keep" | "exact";
	sections: string[];
	restoreSecrets: boolean;
};

// the client's JSON default would turn the form into JSON; the browser adds the boundary
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

function rollbackForm(file: File, choice?: RollbackChoice) {
	const form = new FormData();
	form.set("file", file);
	if (choice) {
		form.set("mode", choice.mode);
		form.set("sections", choice.sections.join(","));
		form.set("restoreSecrets", String(choice.restoreSecrets));
	}
	return form;
}

const base = (projectId: string) => `/v1/${projectId}/backups`;

export const backupsService = {
	/** the sections this instance can back up, from the server's registry */
	async sections(projectId: string): Promise<BackupSection[]> {
		const res = await httpClient.get(`${base(projectId)}/sections`);
		return res.data.sections;
	},

	async list(projectId: string): Promise<{ backups: BackupRow[]; retentionDays: number }> {
		const res = await httpClient.get(base(projectId));
		return res.data;
	},

	async start(projectId: string, body: StartBackupBody): Promise<{ id: string }> {
		const res = await httpClient.post(base(projectId), body);
		return res.data;
	},

	async schedule(projectId: string): Promise<BackupScheduleView> {
		const res = await httpClient.get(`${base(projectId)}/schedule`);
		return res.data;
	},

	async saveSchedule(
		projectId: string,
		body: BackupSchedule & { integrationId: string },
	): Promise<BackupScheduleView> {
		const res = await httpClient.put(`${base(projectId)}/schedule`, body);
		return res.data;
	},

	/** uploads to the saved Object Storage integration now */
	async backupNow(projectId: string): Promise<{ id: string }> {
		const res = await httpClient.post(`${base(projectId)}/object-storage`);
		return res.data;
	},

	/** the folders in the integration's bucket that hold backups */
	async remotePrefixes(projectId: string, integrationId: string): Promise<string[]> {
		const res = await httpClient.get(`${base(projectId)}/remote/prefixes`, {
			params: { integrationId },
		});
		return res.data.prefixes;
	},

	/** complete backups under a prefix, newest first */
	async remoteBackups(
		projectId: string,
		integrationId: string,
		prefix: string,
	): Promise<RemoteBackup[]> {
		const res = await httpClient.get(`${base(projectId)}/remote`, {
			params: { integrationId, prefix },
		});
		return res.data.backups;
	},

	/** downloads the backup on the server and says what it holds; creates nothing */
	async inspectRemote(projectId: string, target: RemoteTarget): Promise<ArchiveSummary> {
		return (await httpClient.post(`${base(projectId)}/remote/inspect`, target)).data;
	},

	/** a new project from the backup; blank optional fields are left out */
	async restoreRemote(
		projectId: string,
		target: RemoteTarget,
		form: ProjectForm,
	): Promise<RestoreResult> {
		const fields = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
		return (await httpClient.post(`${base(projectId)}/remote/restore`, { ...target, ...fields }))
			.data;
	},

	/** what rolling this project back to the file would change; writes nothing */
	async inspectRollback(projectId: string, file: File): Promise<RollbackSummary> {
		return (
			await httpClient.post(`${base(projectId)}/rollback/inspect`, rollbackForm(file), MULTIPART)
		).data;
	},

	/** backs the project up, then rolls it back to the file */
	async rollback(projectId: string, file: File, choice: RollbackChoice): Promise<RollbackResult> {
		return (
			await httpClient.post(`${base(projectId)}/rollback`, rollbackForm(file, choice), MULTIPART)
		).data;
	},

	async inspectRemoteRollback(projectId: string, target: RemoteTarget): Promise<RollbackSummary> {
		return (await httpClient.post(`${base(projectId)}/remote/rollback/inspect`, target)).data;
	},

	async remoteRollback(
		projectId: string,
		target: RemoteTarget,
		choice: RollbackChoice,
	): Promise<RollbackResult> {
		return (await httpClient.post(`${base(projectId)}/remote/rollback`, { ...target, ...choice }))
			.data;
	},

	async gitSettings(projectId: string): Promise<GitSettingsView> {
		return (await httpClient.get(`${base(projectId)}/git`)).data;
	},

	async saveGitSettings(projectId: string, body: GitSettings): Promise<GitSettingsView> {
		return (await httpClient.put(`${base(projectId)}/git`, body)).data;
	},

	/** backs the project up as one commit on the branch */
	async gitCommit(projectId: string, message: string): Promise<{ id: string }> {
		return (await httpClient.post(`${base(projectId)}/git/commit`, { message })).data;
	},

	/** the branch's newest commits, newest first */
	async gitCommits(projectId: string): Promise<GitCommit[]> {
		return (await httpClient.get(`${base(projectId)}/git/commits`)).data.commits;
	},

	async inspectGit(projectId: string, sha: string): Promise<ArchiveSummary> {
		return (await httpClient.post(`${base(projectId)}/git/inspect`, { sha })).data;
	},

	/** a new project from the commit; blank optional fields are left out */
	async restoreGit(projectId: string, sha: string, form: ProjectForm): Promise<RestoreResult> {
		const fields = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
		return (await httpClient.post(`${base(projectId)}/git/restore`, { sha, ...fields })).data;
	},

	/**
	 * A real address for a link or the browser's download: the admin API, not the
	 * portal's own base path, since the archive is served by the API.
	 */
	downloadUrl(projectId: string, id: string) {
		return `${httpClient.defaults.baseURL}${base(projectId)}/${id}/download`;
	},
};
