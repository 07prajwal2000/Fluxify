import { projectSettingsService } from "@/services/projectSettings";
import { QueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";

export const projectSettingsQuery = {
  getAll: {
    useQuery(projectId: string) {
      return useQuery({
        queryKey: ["projectSettings", "keys", projectId],
        queryFn: () => projectSettingsService.getAll(projectId),
        refetchOnWindowFocus: false,
        enabled: !!projectId,
      });
    },
    invalidate(projectId: string, queryClient: QueryClient) {
      queryClient.invalidateQueries({
        queryKey: ["projectSettings", "keys", projectId],
      });
    },
  },
  upsert: {
    useMutation(projectId: string, queryClient: QueryClient) {
      return useMutation({
        mutationFn: (
          data: z.infer<typeof projectSettingsService.upsertRequestBodySchema>,
        ) => projectSettingsService.upsert(projectId, data),
        onSuccess: () => {
          projectSettingsQuery.getAll.invalidate(projectId, queryClient);
        },
      });
    },
  },
  invalidateAll(queryClient: QueryClient) {
    queryClient.invalidateQueries({
      queryKey: ["projectSettings"],
    });
  },
};
