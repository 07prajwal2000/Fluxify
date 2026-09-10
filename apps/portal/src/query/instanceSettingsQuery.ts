import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { requestBodySchema as upsertRequestBodySchema } from "@fluxify/server/src/api/v1/instance-settings/upsert/dto";
import type { requestBodySchema as patchAuthRequestBodySchema } from "@fluxify/server/src/api/v1/instance-settings/patch-auth-settings/dto";
import { instanceSettingsService, type SetLicenseBody } from "@/services/instanceSettings";

const KEY = ["instance-settings"];
const AUTH_KEY = ["instance-settings", "auth"];
const LICENSE_KEY = ["instance-settings", "license"];

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
	auth: {
		useQuery() {
			return useQuery({
				queryKey: AUTH_KEY,
				queryFn: () => instanceSettingsService.getAuth(),
				refetchOnWindowFocus: false,
			});
		},
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof patchAuthRequestBodySchema>) =>
					instanceSettingsService.patchAuth(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: AUTH_KEY }),
			});
		},
	},
	license: {
		useQuery() {
			return useQuery({
				queryKey: LICENSE_KEY,
				queryFn: () => instanceSettingsService.getLicense(),
				refetchOnWindowFocus: false,
			});
		},
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: SetLicenseBody) => instanceSettingsService.setLicense(body),
				onSuccess: (view) => {
					qc.setQueryData(LICENSE_KEY, view);
					// The enterprise hints read the license from public settings.
					qc.invalidateQueries({ queryKey: ["public-settings"] });
				},
			});
		},
	},
};
