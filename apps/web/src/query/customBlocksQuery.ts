import {
  GetAllCustomBlocksQueryType,
  customBlocksService,
} from "@/services/customBlocks";
import { QueryClient, useQuery } from "@tanstack/react-query";

export const customBlocksQueries = {
  getAll: {
    useQuery(query: GetAllCustomBlocksQueryType) {
      return useQuery({
        queryKey: ["custom-blocks", "list", query.projectId],
        queryFn: async () => {
          return await customBlocksService.getAll(query);
        },
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000,
      });
    },
    invalidate(client: QueryClient, projectId: string) {
      client.invalidateQueries({
        queryKey: ["custom-blocks", "list", projectId],
        exact: false,
      });
    },
  },
  getById: {
    useQuery(id: string) {
      return useQuery({
        queryKey: ["custom-blocks", id],
        queryFn: async () => {
          return await customBlocksService.getByID(id);
        },
        refetchOnWindowFocus: false,
        enabled: !!id,
      });
    },
    invalidate(client: QueryClient, id: string) {
      return client.invalidateQueries({
        queryKey: ["custom-blocks", id],
        exact: false,
      });
    },
  },
  invalidateAll(client: QueryClient) {
    return client.invalidateQueries({
      queryKey: ["custom-blocks"],
      exact: false,
    });
  },
  getCanvasItems: {
    useQuery(id: string) {
      return useQuery({
        queryKey: ["custom-blocks", "canvas", id],
        queryFn: async () => {
          return await customBlocksService.getCanvasItems(id);
        },
        refetchOnWindowFocus: false,
        enabled: !!id,
      });
    },
    invalidate(client: QueryClient, id: string) {
      return client.invalidateQueries({
        queryKey: ["custom-blocks", "canvas", id],
        exact: false,
      });
    },
  },
};
