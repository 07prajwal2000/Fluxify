import { projectMembersService } from "@/services/projectMembers";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";

type ListQuery = z.infer<typeof projectMembersService.listRequestQuerySchema>;

export const projectMembersQuery = {
  list: {
    useQuery(projectId: string, query: ListQuery) {
      return useQuery({
        queryKey: ["project-members", projectId, "list", query],
        queryFn: () => projectMembersService.list(projectId, query),
        refetchOnWindowFocus: false,
      });
    },
    invalidate(projectId: string, query: ListQuery, client: QueryClient) {
      client.invalidateQueries({
        queryKey: ["project-members", projectId, "list", query],
      });
    },
    invalidateAll(projectId: string, client: QueryClient) {
      client.invalidateQueries({
        queryKey: ["project-members", projectId, "list"],
      });
    },
  },
  add: {
    useMutation(projectId: string) {
      return useMutation({
        mutationFn: (
          body: z.infer<typeof projectMembersService.addRequestBodySchema>
        ) => projectMembersService.add(projectId, body),
        onSuccess: (_, __, ___, ctx) => {
          ctx.client.invalidateQueries({
            queryKey: ["project-members", projectId],
          });
        },
      });
    },
  },
  update: {
    useMutation(projectId: string) {
      return useMutation({
        mutationFn: (params: {
          userId: string;
          body: z.infer<typeof projectMembersService.updateRequestBodySchema>;
        }) =>
          projectMembersService.update(projectId, params.userId, params.body),
        onSuccess: (_, __, ___, ctx) => {
          ctx.client.invalidateQueries({
            queryKey: ["project-members", projectId],
          });
        },
      });
    },
  },
  remove: {
    useMutation(projectId: string) {
      return useMutation({
        mutationFn: (userId: string) =>
          projectMembersService.remove(projectId, userId),
        onSuccess: (_, __, ___, ctx) => {
          ctx.client.invalidateQueries({
            queryKey: ["project-members", projectId],
          });
        },
      });
    },
  },
};
