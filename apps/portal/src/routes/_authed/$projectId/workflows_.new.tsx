import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Checkbox,
	Input,
	Label,
	NumberField,
	TextArea,
	TextField,
	toast,
} from "@fluxify/components";
import { TbBolt, TbExternalLink } from "react-icons/tb";
import {
	FormWizard,
	SummaryItem,
	type WizardStep,
} from "@/components/common/FormWizard";
import { withBasePath } from "@/constants/routes";
import { triggersQuery } from "@/query/triggersQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/workflows_/new")({
	head: createRouteHead(
		"New Workflow",
		"Create a background workflow and choose what starts it.",
	),
	component: CreateWorkflowPage,
});

function CreateWorkflowPage() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const create = workflowsQuery.create.mutation();
	const attach = triggersQuery.attach.mutation();
	const { data: triggers } = triggersQuery.getAll.useQuery({
		projectId,
		perPage: 50,
	});

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [timeoutSeconds, setTimeoutSeconds] = useState(300);
	const [tracingEnabled, setTracingEnabled] = useState(false);
	const [recordExecution, setRecordExecution] = useState(true);
	const [triggerIds, setTriggerIds] = useState<string[]>([]);

	const nameIsValid = name.trim().length >= 2;
	const available = triggers?.data ?? [];

	function submit() {
		create.mutate(
			{
				name: name.trim(),
				description: description.trim() || undefined,
				projectId,
				timeoutSeconds,
				tracingEnabled,
				recordExecution,
			},
			{
				onSuccess: async (created) => {
					// The links can only be made once the workflow has an id. A failure
					// here leaves a real workflow with fewer triggers than asked for, so
					// it is reported rather than swallowed — the settings tab can fix it.
					try {
						for (const id of triggerIds) {
							await attach.mutateAsync({ id, workflowId: created.id });
						}
					} catch (error) {
						showErrorNotification(error as Error);
					}
					toast.success("Workflow created");
					navigate({
						to: "/$projectId/workflow-canvas/$workflowId",
						params: { projectId, workflowId: created.id },
					});
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	const steps: WizardStep[] = [
		{
			key: "basics",
			label: "Basics",
			title: "Name the workflow",
			description: "What this work is, so the run list is readable later.",
			isValid: nameIsValid,
			content: (
				<div className="flex flex-col gap-5">
					<TextField
						isRequired
						autoFocus
						value={name}
						onChange={setName}
						isInvalid={name.length > 0 && !nameIsValid}
					>
						<Label>Name</Label>
						<Input placeholder="Nightly report" />
					</TextField>

					<div className="flex flex-col gap-1.5">
						<Label>Description</Label>
						<TextArea
							rows={3}
							placeholder="What this workflow does"
							value={description}
							onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
								setDescription(e.target.value)
							}
						/>
					</div>
				</div>
			),
		},
		{
			key: "execution",
			label: "Execution",
			title: "How long, and what to keep",
			description:
				"Background work may be slower than a request, but not endless.",
			content: (
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-1">
						<NumberField
							value={timeoutSeconds}
							minValue={30}
							maxValue={3600}
							onChange={(next) =>
								setTimeoutSeconds(Math.min(3600, Math.max(30, next || 30)))
							}
						>
							<Label>Timeout (seconds)</Label>
							<NumberField.Group>
								<NumberField.DecrementButton />
								<NumberField.Input />
								<NumberField.IncrementButton />
							</NumberField.Group>
						</NumberField>
						<p className="text-xs text-muted">
							A run that passes this is stopped. Between 30 seconds and an hour.
						</p>
					</div>

					<Checkbox
						isSelected={recordExecution}
						onChange={setRecordExecution}
						label="Record executions"
						description="Keeps each run in the Executions list. Turn it off for something that runs every few seconds."
					/>
					<Checkbox
						isSelected={tracingEnabled}
						onChange={setTracingEnabled}
						label="Send traces"
						description="Only useful once the project has a tracing destination configured."
					/>
				</div>
			),
		},
		{
			key: "triggers",
			label: "Triggers",
			title: "Choose what starts it",
			description:
				"Optional. A trigger belongs to the project, so attaching one here does not take it from the workflows already using it.",
			content: (
				<TriggerPicker
					projectId={projectId}
					triggers={available}
					value={triggerIds}
					onChange={setTriggerIds}
				/>
			),
		},
		{
			key: "review",
			label: "Review",
			title: "Review and create",
			description: "The canvas opens next, with an entrypoint and an error handler.",
			content: (
				<div className="flex flex-col gap-5">
					<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
						<SummaryItem label="Name" value={name.trim()} />
						<SummaryItem label="Timeout" value={`${timeoutSeconds}s`} />
						<SummaryItem
							label="Executions"
							value={recordExecution ? "Recorded" : "Not recorded"}
						/>
						<SummaryItem
							label="Triggers"
							value={
								triggerIds.length === 0
									? "None — runs by hand"
									: `${triggerIds.length} attached`
							}
						/>
					</dl>
					<p className="text-xs text-muted">
						It starts inactive. Build it, then activate it — an inactive
						workflow never runs.
					</p>
				</div>
			),
		},
	];

	return (
		<FormWizard
			title="Create a workflow"
			description="Work that runs in the background. No URL, no caller waiting."
			onBack={() => navigate({ to: "/$projectId/workflows", params: { projectId } })}
			steps={steps}
			submitLabel="Create workflow"
			isPending={create.isPending || attach.isPending}
			onSubmit={submit}
		/>
	);
}

/** Multi-select over the project's triggers, as toggleable cards. */
function TriggerPicker({
	projectId,
	triggers,
	value,
	onChange,
}: {
	projectId: string;
	triggers: { id: string; name: string; type: string; schedule: string | null }[];
	value: string[];
	onChange: (value: string[]) => void;
}) {
	if (triggers.length === 0)
		return (
			<div className="flex flex-col items-center rounded-lg border border-dashed border-border px-4 py-10 text-center">
				<TbBolt size={26} className="mb-2 text-muted" />
				<p className="text-sm font-medium text-foreground">
					No triggers in this project yet
				</p>
				<p className="mt-1 text-xs text-muted">
					You can create the workflow now and attach one later from its
					settings.
				</p>
				<button
					type="button"
					onClick={() =>
						window.open(
							withBasePath(`/${projectId}/triggers/new`),
							"_blank",
							"noopener,noreferrer",
						)
					}
					className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
				>
					<TbExternalLink size={14} /> Make one in a new tab
				</button>
			</div>
		);

	return (
		<div className="grid grid-cols-2 gap-2">
			{triggers.map((trigger) => {
				const selected = value.includes(trigger.id);
				return (
					<button
						key={trigger.id}
						type="button"
						onClick={() =>
							onChange(
								selected
									? value.filter((id) => id !== trigger.id)
									: [...value, trigger.id],
							)
						}
						className={`rounded-lg border px-3 py-2 text-left transition-colors ${
							selected
								? "border-accent bg-accent/10"
								: "border-border bg-surface hover:bg-surface-secondary"
						}`}
					>
						<p className="truncate text-sm font-medium text-foreground">
							{trigger.name}
						</p>
						<p className="truncate text-xs text-muted">
							{trigger.type === "schedule" ? (
								<span className="font-mono">{trigger.schedule}</span>
							) : (
								trigger.type
							)}
						</p>
					</button>
				);
			})}
		</div>
	);
}
