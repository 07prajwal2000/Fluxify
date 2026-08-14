import { useState, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, Spinner } from "@fluxify/components";
import { TbPlugConnected, TbAlertTriangle, TbFileCode, TbDots } from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { integrationsQuery } from "@/query/integrationsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { PromptEditor } from "./PromptEditor";
import { STARTERS } from "./starters";
import { useAiModels } from "./useAiModels";

const logo = `${import.meta.env.BASE_URL}icons/logo.webp`;

export function AiHome() {
	const { projectId } = useParams({ from: "/_authed/$projectId/ai/" });
	const navigate = useNavigate();
	const [query, setQuery] = useState("");

	const { models, defaultModelId, isBlocked, isLoading } = useAiModels(projectId);
	const sendMessage = harnessConversationsQuery.sendMessage.mutation(projectId);

	const submit = (q: string, model: string, isFallback: boolean) => {
		// Only pass model/integration ID if it's NOT the fallback project setting
		const reqPayload: { query: string; integrationId?: string } = { query: q };
		if (!isFallback && model) {
			reqPayload.integrationId = model;
		}

		sendMessage.mutate(
			reqPayload,
			{
				onSuccess: (res) => {
					setQuery("");
					// Smooth cross-fade into the conversation the API just created.
					navigate({
						to: "/$projectId/ai/$conversationId",
						params: { projectId, conversationId: res.conversationId },
						viewTransition: true,
					});
				},
				onError: (err) => showErrorNotification(err),
			},
		);
	};

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (isBlocked) {
		return (
			<div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
				<div className="flex size-16 items-center justify-center rounded-full bg-danger/10 text-danger">
					<TbAlertTriangle size={32} />
				</div>
				<div className="flex flex-col gap-2">
					<h2 className="text-xl font-semibold text-foreground">AI Integration Required</h2>
					<p className="text-sm text-muted leading-relaxed">
						You need to configure an AI integration to use the agent. Please set up a model and enable "Use for Harness", or set the project default agent connection.
					</p>
				</div>
				<a
					href={`/_/admin/ui/${projectId}/integrations?group=ai`}
					className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
				>
					<TbPlugConnected size={18} />
					Configure Integrations
				</a>
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
				isPending={sendMessage.isPending}
				models={models}
				defaultModelId={defaultModelId}
				minRows={2}
				maxRows={3}
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
