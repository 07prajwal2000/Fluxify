import { httpClient } from "@/lib/http";

export type BackupMode = "backup" | "template";

/** one row of a project's backup history (#1103); dates arrive as ISO strings */
export interface BackupRow {
	id: string;
	type: "manual" | "object_storage";
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
	/** the bucket key of an object storage backup */
	destinationKey: string | null;
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

	/**
	 * A real address for a link or the browser's download: the admin API, not the
	 * portal's own base path, since the archive is served by the API.
	 */
	downloadUrl(projectId: string, id: string) {
		return `${httpClient.defaults.baseURL}${base(projectId)}/${id}/download`;
	},
};
