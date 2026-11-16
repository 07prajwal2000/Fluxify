import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LIST_KEY as ROUTES_KEY } from "@/query/routesQuery";
import { LIST_KEY as WORKFLOWS_KEY } from "@/query/workflowsQuery";
import { type BundleOf, type ResourceType, transferService } from "@/services/transfer";

const LIST_KEYS = { route: ROUTES_KEY, workflow: WORKFLOWS_KEY };

export const transferQuery = {
	import: {
		mutation<T extends ResourceType>(type: T) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { projectId: string; bundle: BundleOf<T> }) =>
					transferService.import(type, data.projectId, data.bundle),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEYS[type] }),
			});
		},
	},
};
