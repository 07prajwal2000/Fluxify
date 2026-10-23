import { Button, toast } from "@fluxify/components";
import type { Param } from "@fluxify/sdk/blocks";
import { useState } from "react";
import { TbPlug } from "react-icons/tb";
import { FormWizard, type WizardStep } from "@/components/common/FormWizard";
import { pluginReviewSections, pluginStepViews } from "@/components/triggers/PluginTriggerStep";
import {
	isPluginTriggerType,
	pluginKindName,
	pluginNameOfKind,
	pluginSource,
	pluginSourceOption,
	pluginTriggerSteps,
	sourceFieldErrors,
} from "@/components/triggers/pluginTrigger";
import { TriggerBasicsStep } from "@/components/triggers/TriggerBasicsStep";
import { errorMessage, NoticeList } from "@/components/triggers/TriggerNotices";
import { type ReviewSection, TriggerReview } from "@/components/triggers/TriggerReview";
import { TriggerWorkflowsField } from "@/components/triggers/TriggerWorkflowsField";
import {
	TRIGGER_DEFAULTS,
	TRIGGER_TYPE_OPTIONS,
	type TriggerType,
	TypeSelector,
} from "@/components/triggers/triggerForm";
import { useBuiltInTriggerForm } from "@/components/triggers/useBuiltInTriggerForm";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import { triggersQuery } from "@/query/triggersQuery";
import type {
	CreateTriggerBody,
	PluginTriggerKind,
	Trigger,
	UpdateTriggerBody,
} from "@/services/triggers";

export type TriggerWizardProps = {
	projectId: string;
	initialTrigger?: Trigger;
	onBack: () => void;
	onSuccess: () => void;
	/** Fill the page's height so only the step scrolls (a saved trigger's page). */
	fill?: boolean;
};

export function TriggerWizard({
	projectId,
	initialTrigger,
	onBack,
	onSuccess,
	fill,
}: TriggerWizardProps) {
	const isEdit = Boolean(initialTrigger);
	const create = triggersQuery.create.mutation();
	const update = triggersQuery.update.mutation();
	const { data: groups } = triggersQuery.groups.useQuery(projectId);
	const builtIn = useBuiltInTriggerForm(initialTrigger);

	const [form, setForm] = useState({
		name: initialTrigger?.name ?? TRIGGER_DEFAULTS.name,
		description: initialTrigger?.description ?? TRIGGER_DEFAULTS.description,
	});
	const [type, setType] = useState<TriggerType>(
		(initialTrigger?.type as TriggerType) || "schedule",
	);
	const [groupId, setGroupId] = useState(initialTrigger?.groupId ?? "");
	const [workflowId, setWorkflowId] = useState<string | null>(initialTrigger?.workflowId ?? null);
	const [active, setActive] = useState(initialTrigger ? initialTrigger.active : true);
	const [pluginValues, setPluginValues] = useState<Record<string, unknown>>(
		(initialTrigger?.source as Record<string, unknown> | null) ?? {},
	);
	// Why the last save was refused, kept on screen: a toast is gone before an
	// AWS permission list can be read.
	const [error, setError] = useState<string | null>(null);
	// `source.<param>` refusals, shown under the field that holds them.
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	// Saved, with something the user should read before the wizard closes.
	const [warnings, setWarnings] = useState<string[]>([]);
	// FormWizard owns its position unless a refused save needs to point at a step.
	const [step, setStep] = useState(0);

	const set = (key: keyof typeof TRIGGER_DEFAULTS, value: string) =>
		setForm((previous) => ({ ...previous, [key]: value }));
	const setPluginField = (name: string, value: unknown) =>
		setPluginValues((previous) => ({ ...previous, [name]: value }));

	const isPlugin = isPluginTriggerType(type);
	const kindName = isPlugin ? pluginKindName(type) : undefined;
	// The Source step lists every kind on create; an edit asks for its own only.
	const kinds = triggersQuery.pluginKinds.useQuery(
		projectId,
		isEdit && kindName ? kindName : undefined,
		!isEdit || isPlugin,
	);
	const kind: PluginTriggerKind | undefined = kindName
		? kinds.data?.find((item) => item.kind === kindName)
		: undefined;
	const plugins = pluginsQuery.list.useQuery(projectId, isEdit && isPlugin);
	const pluginRow =
		isPlugin && kindName
			? plugins.data?.find((item) => item.name === pluginNameOfKind(kindName))
			: undefined;
	const pluginCheckLoading = isEdit && isPlugin && (kinds.isLoading || plugins.isLoading);
	// The kind endpoint only lists plugins switched on somewhere, so a missing
	// kind is either a disabled plugin or one that dropped it in an upgrade.
	const pluginOff =
		isEdit &&
		isPlugin &&
		!pluginCheckLoading &&
		!kind &&
		Boolean(pluginRow) &&
		!pluginRow?.devEnabled &&
		!pluginRow?.prodEnabled;
	const kindGone = isEdit && isPlugin && !pluginCheckLoading && !kind && !pluginOff;
	const readOnly = pluginOff;

	const nameIsValid = form.name.trim().length >= 2;
	const isConnector = !isPlugin && type !== "schedule";
	const sourceOptions = [...TRIGGER_TYPE_OPTIONS, ...(kinds.data ?? []).map(pluginSourceOption)];
	const typeOption = sourceOptions.find((option) => option.id === type) ?? {
		id: type,
		label: kindName ?? type,
		hint: "",
		icon: <TbPlug size={20} />,
		available: true,
	};
	const pluginParams = (kind?.params ?? {}) as Record<string, Param>;
	const pluginSteps = kind ? pluginTriggerSteps(pluginParams, kind.tabs, pluginValues) : [];
	const groupName =
		(groups ?? []).find((group) => group.id === groupId)?.name ??
		(groups ?? []).find((group) => group.isDefault)?.name ??
		"Default";

	const typeFields: Record<string, unknown> = isPlugin
		? {
				// An unknown kind keeps its stored source: there are no params to rebuild it from.
				source: kind
					? pluginSource(pluginParams, pluginValues)
					: ((initialTrigger?.source ?? {}) as Record<string, unknown>),
				...(kind?.retry
					? {
							maxAttempts: builtIn.delivery.maxAttempts,
							retryDelayMs: builtIn.delivery.retryDelayMs,
						}
					: {}),
			}
		: builtIn.fieldsFor(type);

	const done = (message: string) => ({
		onSuccess: (result: { warnings?: string[] }) => {
			toast.success(message);
			if (result.warnings?.length) setWarnings(result.warnings);
			else onSuccess();
		},
		onError: (failure: unknown) => {
			const byParam = sourceFieldErrors(parseApiError(failure).fieldErrors);
			setFieldErrors(byParam);
			setError(errorMessage(failure));
			// Point at the first refused field, in the step that holds it.
			const first = Object.keys(byParam)[0];
			const index = first ? pluginSteps.findIndex((item) => item.items.includes(first)) : -1;
			if (index >= 0) setStep((isEdit ? 1 : 2) + index);
			showErrorNotification(failure as Error);
		},
	});

	function submit() {
		setError(null);
		setFieldErrors({});
		const shared = {
			name: form.name.trim(),
			description: form.description.trim() || undefined,
			groupId: groupId || undefined,
			active,
			...typeFields,
		};
		if (initialTrigger) {
			const body: UpdateTriggerBody = { ...shared, workflowId };
			update.mutate({ id: initialTrigger.id, body }, done("Trigger updated"));
		} else {
			create.mutate(
				{ ...shared, type, projectId, workflowId: workflowId ?? undefined } as CreateTriggerBody,
				done("Trigger created"),
			);
		}
	}

	if (warnings.length > 0) {
		return (
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Trigger saved</h1>
					<p className="text-xs text-muted">
						It works as set up, but read these before you rely on it.
					</p>
				</div>
				<NoticeList status="warning" title="Worth knowing" items={warnings} />
				<Button variant="primary" size="sm" className="self-end" onPress={onSuccess}>
					Done
				</Button>
			</div>
		);
	}

	const pluginStepsView: WizardStep[] = kind
		? pluginStepViews({
				projectId,
				kind,
				steps: pluginSteps,
				values: pluginValues,
				setField: setPluginField,
				errors: fieldErrors,
				readOnly,
			})
		: [];

	const reviewSections: ReviewSection[] = isPlugin
		? [
				{
					title: "Trigger",
					rows: [
						{ label: "Name", value: form.name.trim() },
						{ label: "Trigger", value: kind?.label ?? typeOption.label },
						...(kind ? [{ label: "Plugin", value: kind.plugin }] : []),
						...(kind?.retry
							? [{ label: "Attempts", value: String(builtIn.delivery.maxAttempts) }]
							: []),
						{ label: "Workflow", value: workflowId ? "Attached" : "None yet" },
						{ label: "Worker Group", value: groupName },
					],
				},
				...(kind ? pluginReviewSections(kind, pluginSteps, pluginValues) : []),
			]
		: [{ rows: builtIn.reviewRows(type) }];

	const notices: { status: "warning" | "danger"; title: string; items: string[] }[] = [];
	if (pluginOff)
		notices.push({
			status: "warning",
			title: "This trigger's plugin is off",
			items: [
				"The plugin is switched off in both environments, so this trigger is read-only and nothing runs it. Turn the plugin on in Settings → Plugins to edit it again.",
			],
		});
	if (kindGone)
		notices.push({
			status: "danger",
			title: "This trigger kind no longer exists",
			items: [
				kindName
					? `No approved plugin of this project provides ${kindName} any more. The trigger is stopped; its saved settings are kept.`
					: "No approved plugin of this project provides this kind any more.",
			],
		});

	const steps: WizardStep[] = [
		// a saved trigger's source is fixed, so it shows in the header instead (#932)
		...(isEdit
			? []
			: [
					{
						key: "type",
						label: "Source",
						title: "What starts it?",
						description: "The rest of the form follows from this.",
						content: <TypeSelector value={type} options={sourceOptions} onChange={setType} />,
					},
				]),
		{
			key: "basics",
			label: "Basics",
			title: isEdit ? "Edit trigger details" : "Name the trigger",
			description: "Something the run list will still make sense under later.",
			isValid: nameIsValid,
			content: (
				<div className="flex flex-col gap-5">
					{notices.map((notice) => (
						<NoticeList key={notice.title} {...notice} />
					))}
					<TriggerBasicsStep
						isEdit={isEdit}
						isConnector={isConnector || isPlugin}
						typeLabel={typeOption.label}
						typeIcon={typeOption.icon}
						form={form}
						set={set}
						nameIsValid={nameIsValid}
						groups={groups ?? []}
						groupId={groupId}
						onGroupChange={setGroupId}
						retry={kind?.retry}
						attempts={builtIn.delivery.maxAttempts}
						onAttemptsChange={(value) =>
							builtIn.setDelivery((previous) => ({ ...previous, maxAttempts: value }))
						}
						retryDelayMs={builtIn.delivery.retryDelayMs}
						onRetryDelayChange={(value) =>
							builtIn.setDelivery((previous) => ({ ...previous, retryDelayMs: value }))
						}
						disabledReason={initialTrigger?.active ? undefined : initialTrigger?.disabledReason}
						readOnly={readOnly}
					/>
				</div>
			),
		},
		...(isPlugin ? [] : builtIn.stepsFor(type, projectId, isEdit)),
		...pluginStepsView,
		{
			key: "workflow",
			label: "Workflow",
			title: "Choose what it starts",
			description:
				"A trigger starts one workflow. To run another workflow from the same source, create a second trigger or use the Trigger Workflow block.",
			content: (
				<TriggerWorkflowsField
					projectId={projectId}
					value={workflowId}
					onChange={setWorkflowId}
					isDisabled={readOnly}
				/>
			),
		},
		{
			key: "review",
			label: "Review",
			title: isEdit ? "Review and save" : "Review and create",
			description: isEdit
				? "Review the updated trigger configuration before saving."
				: "Last look before the trigger goes live.",
			content: (
				<TriggerReview
					sections={reviewSections}
					active={active}
					onActiveChange={setActive}
					isEdit={isEdit}
					isConnector={isConnector}
					disabledReason={initialTrigger?.disabledReason}
					error={error}
					readOnly={readOnly}
				/>
			),
		},
	];

	return (
		<FormWizard
			title={isEdit ? "Edit trigger" : "Create a trigger"}
			description={
				isEdit
					? "Update trigger settings and the workflow it starts."
					: "A trigger is a source that starts one workflow."
			}
			onBack={onBack}
			fill={fill}
			readOnly={readOnly}
			step={step}
			onStepChange={setStep}
			badge={
				isEdit && typeOption ? (
					<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-foreground">
						<span className="text-accent [&_svg]:size-3.5" aria-hidden>
							{typeOption.icon}
						</span>
						{typeOption.label}
					</span>
				) : undefined
			}
			steps={steps}
			submitLabel={isEdit ? "Save changes" : "Create trigger"}
			isPending={isEdit ? update.isPending : create.isPending}
			onSubmit={submit}
		/>
	);
}
