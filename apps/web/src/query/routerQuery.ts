import { GetAllRequestQueryType, routesService } from "@/services/routes";
import { QueryClient, useQuery } from "@tanstack/react-query";

export const routesQueries = {
  getAll: {
    useQuery(query: GetAllRequestQueryType) {
      return useQuery({
        queryKey: ["routes", "list", JSON.stringify(query)],
        queryFn: async () => {
          return await routesService.getAll(query);
        },
        refetchOnWindowFocus: false,
      });
    },
    invalidate(client: QueryClient) {
      client.invalidateQueries({
        queryKey: ["routes", "list"],
        exact: false,
      });
    },
  },
  getById: {
    useQuery(id: string) {
      return useQuery({
        queryKey: ["routes", id],
        queryFn: async () => {
          return await routesService.getByID(id);
        },
        refetchOnWindowFocus: false,
      });
    },
    invalidate(client: QueryClient, id: string) {
      return client.invalidateQueries({
        queryKey: ["routes", id],
        exact: false,
      });
    },
  },
  getCanvasItems: {
    useQuery(id: string) {
      return useQuery({
        queryKey: ["routes", id, "canvas-items"],
        queryFn: async () => {
          return await routesService.getCanvasItems(id);
        },
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      });
    },
    invalidate(client: QueryClient, id: string) {
      return client.invalidateQueries({
        queryKey: ["routes", id, "canvas-items"],
        exact: false,
      });
    },
  },
  invalidateAll(client: QueryClient) {
    return client.invalidateQueries({
      queryKey: ["routes"],
      exact: false,
    });
  },
};
