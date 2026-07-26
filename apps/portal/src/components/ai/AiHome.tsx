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
import type { AiModel } from "./ModelSelect";

const logo = `${import.meta.env.BASE_URL}logo.webp`;

export function AiHome() {
	const { projectId } = useParams({ from: "/_authed/$projectId/ai/" });
	const navigate = useNavigate();
	const [query, setQuery] = useState("");

	const { data: integrationsData, isLoading: isLoadingInts } = integrationsQuery.getBasicList.useQuery(projectId);
	const { data: settingsData, isLoading: isLoadingSettings } = projectSettingsKeysQuery.getAll.useQuery(projectId);

	const sendMessage = harnessConversationsQuery.sendMessage.mutation(projectId);

	const { models, defaultModelId, isBlocked, isLoading } = useMemo(() => {
		if (isLoadingInts || isLoadingSettings) {
			return { models: [], defaultModelId: "", isBlocked: false, isLoading: true };
		}
		
		const allIntegrations = integrationsData ?? [];
		
		// Filter AI models based on useForHarness (assuming it's in config or we just check group === 'ai' and useForHarness)
		// We'll filter based on group === "ai" and config.useForHarness
		const aiIntegrations = allIntegrations.filter((i: any) => 
			i.group === "ai" && (i.config as Record<string, unknown>)?.useForHarness === true
		);
		
		let availableModels: AiModel[] = aiIntegrations.map((i: any) => ({
			id: i.id,
			name: i.name,
		}));

		let defId = availableModels[0]?.id || "";
		let blocked = false;

		if (availableModels.length === 0) {

			const agentConnectionId = settingsData?.["settings.ai.agentConnectionId"];
			if (agentConnectionId) {
				const fallbackInt = allIntegrations.find((i: any) => i.id === agentConnectionId);
				availableModels = [{
					id: agentConnectionId,
					name: fallbackInt?.name || "Project Default",
					isFallback: true
				}];
				defId = agentConnectionId;
			} else {
				blocked = true;
			}
		}

		return { models: availableModels, defaultModelId: defId, isBlocked: blocked, isLoading: false };
	}, [integrationsData, settingsData, isLoadingInts, isLoadingSettings]);

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
				<div className="flex size-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
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
					className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
				>
					<TbPlugConnected size={18} />
					Configure Integrations
				</a>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-24 pb-12">
			<div className="flex flex-col items-center gap-4 text-center">
				<div className="relative">
					<div className="pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full bg-accent/20 blur-3xl" />
					<img src={logo} alt="Fluxify AI" className="size-16 object-contain" />
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
			/>

			<div className="flex flex-wrap justify-center gap-2">
				{STARTERS.map((s) => (
					<Button
						key={s.label}
						size="sm"
						className="rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-4 py-2 text-white/70 hover:bg-white/10 hover:text-white"
						onPress={() => setQuery(s.prompt)}
					>
						{s.label}
					</Button>
				))}
			</div>
		</div>
	);
}
