import type { responseSchema as filtersResponseSchema } from "@fluxify/server/src/api/v1/instance-settings/audit-logs/filters/dto";
import type {
	auditRowSchema,
	responseSchema,
} from "@fluxify/server/src/api/v1/instance-settings/audit-logs/list/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

export type AuditRow = z.infer<typeof auditRowSchema>;
export type AuditPage = z.infer<typeof responseSchema>;
export type AuditFilterOptions = z.infer<typeof filtersResponseSchema>;

/** What the filter bar sets; an empty or missing value means "any". */
export type AuditFilters = {
	/** project id, also of a deleted project */
	projectId?: string;
	actorEmail?: string;
	resourceType?: string;
	action?: string;
	source?: AuditRow["source"];
	resourceId?: string;
	/** a day, `YYYY-MM-DD`, in the viewer's time zone */
	from?: string;
	to?: string;
};

const baseUrl = "/v1/instance-settings/audit-logs";

/** A day in the viewer's zone as the instant it starts, `plusDays` later. */
function dayStart(day: string | undefined, plusDays = 0) {
	if (!day) return undefined;
	const start = new Date(`${day}T00:00:00`);
	if (Number.isNaN(start.getTime())) return undefined;
	start.setDate(start.getDate() + plusDays);
	return start.toISOString();
}

export const auditLogsService = {
	async list(filters: AuditFilters, cursor?: string): Promise<AuditPage> {
		const { from, to, ...rest } = filters;
		const result = await httpClient.get(baseUrl, {
			// `to` is a whole day: up to the start of the next one
			params: { ...rest, from: dayStart(from), to: dayStart(to, 1), cursor },
		});
		return result.data;
	},
	async filters(): Promise<AuditFilterOptions> {
		const result = await httpClient.get(`${baseUrl}/filters`);
		return result.data;
	},
};
