import { useParams } from "@tanstack/react-router";
import { agentConversationsQuery } from "@/query/agentConversationsQuery";
import { type Data, rec } from "./data";

/** The resource a call targets, as it is now (read through the gateway with the agent's own get tool). */
export function useCurrent(tool: string, input: Data, enabled: boolean) {
	const { projectId = "" } = useParams({ strict: false }) as { projectId?: string };
	const q = agentConversationsQuery.preview.resource.useQuery(
		projectId,
		tool,
		input,
		enabled && Boolean(projectId),
	);
	return {
		current: q.data?.current ? rec(q.data.current) : undefined,
		loading: q.isLoading,
		failed: q.isError,
	};
}
