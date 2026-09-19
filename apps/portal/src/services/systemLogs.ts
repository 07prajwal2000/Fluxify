import type {
	systemLogSchema,
	systemLogsQuerySchema,
} from "@fluxify/server/src/api/v1/projects/system-logs/route";
import type z from "zod";
import { httpClient } from "@/lib/http";

export type SystemLog = z.infer<typeof systemLogSchema>;
export type SystemLogsQuery = Partial<z.input<typeof systemLogsQuerySchema>>;

export const systemLogsService = {
	/** newest first */
	async list(projectId: string, query: SystemLogsQuery = {}): Promise<SystemLog[]> {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) params.set(key, String(value));
		}
		const result = await httpClient.get(`/v1/projects/${projectId}/system-logs?${params}`);
		return result.data.items;
	},
};
