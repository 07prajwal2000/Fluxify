import { testSuitesService } from "@/services/testSuites";
import { QueryClient, useQuery, useMutation } from "@tanstack/react-query";

export const testSuitesQueries = {
  getAll: {
    useQuery(routeId: string) {
      return useQuery({
        queryKey: ["testSuites", "list", routeId],
        queryFn: async () => {
          return await testSuitesService.getAll(routeId);
        },
        refetchOnWindowFocus: false,
        enabled: !!routeId,
      });
    },
    invalidate(client: QueryClient, routeId?: string) {
      client.invalidateQueries({
        queryKey: routeId
          ? ["testSuites", "list", routeId]
          : ["testSuites", "list"],
        exact: false,
      });
    },
  },
  getById: {
    useQuery(id: string) {
      return useQuery({
        queryKey: ["testSuites", id],
        queryFn: async () => {
          return await testSuitesService.getByID(id);
        },
        refetchOnWindowFocus: false,
        enabled: !!id,
      });
    },
    invalidate(client: QueryClient, id: string) {
      client.invalidateQueries({
        queryKey: ["testSuites", id],
        exact: false,
      });
    },
  },
  create: {
    useMutation() {
      return useMutation({
        mutationFn: async (data: any) => await testSuitesService.create(data),
      });
    },
  },
  update: {
    useMutation() {
      return useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) =>
          await testSuitesService.update(id, data),
      });
    },
  },
  delete: {
    useMutation() {
      return useMutation({
        mutationFn: async (id: string) => await testSuitesService.delete(id),
      });
    },
  },
  run: {
    useMutation() {
      return useMutation({
        mutationFn: async (id: string) => await testSuitesService.run(id),
      });
    },
  },
  runAll: {
    useMutation() {
      return useMutation({
        mutationFn: async (routeId: string) =>
          await testSuitesService.runAll(routeId),
      });
    },
  },
  invalidateAll(client: QueryClient) {
    client.invalidateQueries({
      queryKey: ["testSuites"],
      exact: false,
    });
  },
};
