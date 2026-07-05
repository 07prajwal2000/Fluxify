import { QueryClient, useMutation, useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { aiGatewayConversationsService } from "@/services/aiGatewayConversations";
import { z } from "zod";
import {
  createConversationDto,
  clearConversationsDto,
  updateMessageDto,
  listConversationsDto,
  listMessagesDto,
} from "@fluxify/ai-gateway";

type CreateConversationQueryParams = z.infer<typeof createConversationDto.queryParamsSchema>;
type CreateConversationBodyParams = z.infer<typeof createConversationDto.requestBodySchema>;

type ListConversationsQueryParams = z.infer<typeof listConversationsDto.queryParamsSchema>;

type UpdateConversationBodyParams = z.infer<typeof updateMessageDto.requestBodySchema>;

type ClearConversationBodyParams = z.infer<typeof clearConversationsDto.requestBodySchema>;

type ListMessagesQueryParams = z.infer<typeof listMessagesDto.queryParamsSchema>;

export const aiGatewayConversationsQuery = {
  list: {
    useQuery(projectId: string, query: ListConversationsQueryParams) {
      return useQuery({
        queryKey: ["ai-conversations", "list", projectId, query],
        queryFn: () => {
          if (!projectId) return [];
          return aiGatewayConversationsService.list(projectId, query);
        },
        refetchOnWindowFocus: false,
      });
    },
    invalidate(projectId: string, queryClient: QueryClient) {
      queryClient.invalidateQueries({
        queryKey: ["ai-conversations", "list", projectId],
      });
    },
  },
  
  listMessages: {
    useQuery(conversationId: string, query: ListMessagesQueryParams) {
      return useQuery({
        queryKey: ["ai-conversations", "listMessages", conversationId, query],
        queryFn: () => {
          if (!conversationId) return null;
          return aiGatewayConversationsService.listMessages(conversationId, query);
        },
        refetchOnWindowFocus: false,
      });
    },
    invalidate(conversationId: string, queryClient: QueryClient) {
      queryClient.invalidateQueries({
        queryKey: ["ai-conversations", "listMessages", conversationId],
      });
    },
  },

  listMessagesInfinite: {
    useInfiniteQuery(conversationId: string, perPage = 5) {
      return useInfiniteQuery({
        queryKey: ["ai-conversations", "listMessagesInfinite", conversationId, perPage],
        queryFn: ({ pageParam = 1 }) => {
          if (!conversationId) return null;
          return aiGatewayConversationsService.listMessages(conversationId, { page: pageParam, perPage });
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
          if (!lastPage || !lastPage.pagination) return undefined;
          return lastPage.pagination.hasNext ? lastPage.pagination.page + 1 : undefined;
        },
        refetchOnWindowFocus: false,
      });
    },
    invalidate(conversationId: string, queryClient: QueryClient) {
      queryClient.invalidateQueries({
        queryKey: ["ai-conversations", "listMessagesInfinite", conversationId],
      });
    },
    appendOptimisticMessage(queryClient: QueryClient, conversationId: string, userQuery: string, perPage = 5) {
      queryClient.setQueryData(
        ["ai-conversations", "listMessagesInfinite", conversationId, perPage],
        (old: any) => {
          if (!old || !old.pages || old.pages.length === 0) return old;
          const updatedFirstPage = {
            ...old.pages[0],
            messages: [
              ...(old.pages[0].messages || []),
              {
                id: `temp-${Date.now()}`,
                userQuery,
                status: "running",
                createdAt: new Date().toISOString(),
              },
            ],
          };
          return {
            ...old,
            pages: [updatedFirstPage, ...old.pages.slice(1)],
          };
        },
      );
    },
  },

  create: {
    useMutation(queryClient: QueryClient) {
      return useMutation({
        mutationFn: ({ query, body }: { query: CreateConversationQueryParams; body: CreateConversationBodyParams }) =>
          aiGatewayConversationsService.create(query, body),
        onSuccess: (data, variables) => {
          if (variables.body.projectId) {
            aiGatewayConversationsQuery.list.invalidate(variables.body.projectId, queryClient);
          }
          if (variables.body.startWorkflow && data?.id) {
            aiGatewayConversationsQuery.listMessages.invalidate(data.id, queryClient);
          }
        },
      });
    },
  },

  update: {
    useMutation(conversationId: string, queryClient: QueryClient) {
      return useMutation({
        mutationFn: (body: UpdateConversationBodyParams) =>
          aiGatewayConversationsService.update(conversationId, body),
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: ["ai-conversations"],
          });
        },
      });
    },
  },

  delete: {
    useMutation(queryClient: QueryClient) {
      return useMutation({
        mutationFn: (conversationId: string) => aiGatewayConversationsService.delete(conversationId),
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: ["ai-conversations", "list"],
          });
        },
      });
    },
  },

  clear: {
    useMutation(conversationId: string, queryClient: QueryClient) {
      return useMutation({
        mutationFn: (body: ClearConversationBodyParams) =>
          aiGatewayConversationsService.clear(conversationId, body),
        onSuccess: () => {
          aiGatewayConversationsQuery.listMessages.invalidate(conversationId, queryClient);
        },
      });
    },
  },
};
