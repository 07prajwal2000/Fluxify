import { Button, Spinner } from "@fluxify/components";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { TbAlertTriangle, TbPlugConnected } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { agentConversationsQuery } from "@/query/agentConversationsQuery";
import type { Effort, Mode } from "@/services/agentConversations";
import { useAgentModel } from "./AgentModel";
import { AgentPickers } from "./AgentPickers";
import { PromptEditor } from "./PromptEditor";
import { STARTERS } from "./starters";
import { queueMessage } from "./useAgentConversation";

const logo = `${import.meta.env.BASE_URL}icons/logo.webp`;

export function AiHome() {
	const { projectId } = useParams({ from: "/_authed/$projectId/ai/" });
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [mode, setMode] = useState<Mode>("manual");
	const [effort, setEffort] = useState<Effort>("none");
	const model = agentConversationsQuery.model.useQuery(projectId);

	const { isLoading, missing } = useAgentModel(projectId);
	const create = agentConversationsQuery.create.mutation(projectId);

	// The conversation page sends the message, so it can show it and follow the run.
	const submit = (q: string) =>
		create.mutate(q.split("\n")[0].slice(0, 80), {
			onSuccess: (conversation) => {
				setQuery("");
				queueMessage(conversation.id, q, { mode, effort });
				navigate({
					to: "/$projectId/ai/$conversationId",
					params: { projectId, conversationId: conversation.id },
					viewTransition: true,
				});
			},
			onError: (err) => showErrorNotification(err),
		});

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (missing) {
		return (
			<div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
				<div className="flex size-16 items-center justify-center rounded-full bg-danger/10 text-danger">
					<TbAlertTriangle size={32} />
				</div>
				<div className="flex flex-col gap-2">
					<h2 className="text-xl font-semibold text-foreground">AI Integration Required</h2>
					<p className="text-sm text-muted leading-relaxed">
						Pick the AI integration the agent runs on in the project's AI configuration.
					</p>
				</div>
				<Link
					to="/$projectId/settings"
					params={{ projectId }}
					search={{ tab: "ai-connections" }}
					className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
				>
					<TbPlugConnected size={18} />
					Open AI configuration
				</Link>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-8 pb-12">
				<div className="flex flex-col items-center gap-4 text-center">
					<div className="relative">
						<div className="pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full bg-accent/20 blur-3xl" />
						<img src={logo} alt="Fluxify AI" className="size-32 object-contain" />
					</div>
					<div className="flex flex-col gap-2">
						<h1 className="text-4xl font-bold tracking-tight text-foreground">
							What will we ship today?
						</h1>
						<p className="text-muted">Agentic backend builder. Just describe it.</p>
					</div>
				</div>

				<PromptEditor
					projectId={projectId}
					value={query}
					onChange={setQuery}
					onSubmit={submit}
					isPending={create.isPending}
					minRows={2}
					maxRows={3}
					controls={
						<AgentPickers
							mode={mode}
							onModeChange={setMode}
							effort={effort}
							onEffortChange={setEffort}
							supportsThinking={model.data?.supportsThinking ?? false}
						/>
					}
				/>

				<div className="flex flex-wrap justify-center gap-2">
					{STARTERS.map((s) => (
						<Button
							key={s.label}
							size="sm"
							variant="outline"
							className="rounded-full border-border bg-surface px-4 py-2 text-muted hover:bg-surface-secondary hover:text-foreground"
							onPress={() => setQuery(s.prompt)}
						>
							{s.label}
						</Button>
					))}
				</div>
			</div>
		</div>
	);
}
