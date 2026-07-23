import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { requestBodySchema as upsertRequestBodySchema } from "@fluxify/server/src/api/v1/instance-settings/upsert/dto";
import { instanceSettingsService } from "@/services/instanceSettings";

const KEY = ["instance-settings"];

export const instanceSettingsQuery = {
	getAll: {
		useQuery() {
			return useQuery({
				queryKey: KEY,
				queryFn: () => instanceSettingsService.getAll(),
				refetchOnWindowFocus: false,
			});
		},
	},
	upsert: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof upsertRequestBodySchema>) =>
					instanceSettingsService.upsert(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
			});
		},
	},
};
