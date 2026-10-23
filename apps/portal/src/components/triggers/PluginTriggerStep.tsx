import type { Param } from "@fluxify/sdk/blocks";
import type { WizardStep } from "@/components/common/FormWizard";
import { PluginParamFields } from "@/components/integrations/PluginIntegrationForm";
import type { PluginParamTab } from "@/components/integrations/pluginParamTabs";
import { missingRequired, paramReviewValue } from "@/components/triggers/pluginTrigger";
import type { ReviewSection } from "@/components/triggers/TriggerReview";
import type { PluginTriggerKind } from "@/services/triggers";

/** The params of one author tab, drawn by the same renderer the canvas and the integration form use. */
export function PluginTriggerStepFields({
	projectId,
	kind,
	step,
	values,
	setField,
	errors,
	readOnly,
}: {
	projectId: string;
	kind: PluginTriggerKind;
	step: PluginParamTab;
	values: Record<string, unknown>;
	setField: (name: string, value: unknown) => void;
	errors?: Record<string, string>;
	readOnly?: boolean;
}) {
	return (
		<PluginParamFields
			projectId={projectId}
			variant={kind.type}
			params={kind.params as Record<string, Param>}
			names={step.items}
			config={values}
			setField={setField}
			errors={errors}
			readOnly={readOnly}
		/>
	);
}

/** One wizard step per author tab, each drawing that tab's params. */
export function pluginStepViews({
	projectId,
	kind,
	steps,
	values,
	setField,
	errors,
	readOnly,
}: {
	projectId: string;
	kind: PluginTriggerKind;
	steps: PluginParamTab[];
	values: Record<string, unknown>;
	setField: (name: string, value: unknown) => void;
	errors: Record<string, string>;
	readOnly?: boolean;
}): WizardStep[] {
	const params = kind.params as Record<string, Param>;
	return steps.map((step) => ({
		key: `plugin-${step.name}`,
		label: step.name,
		title: step.name === "Settings" ? "Set the trigger up" : step.name,
		description: `The ${kind.label} trigger's ${step.name.toLowerCase()} settings.`,
		isValid: missingRequired(params, step.items, values).length === 0,
		content: (
			<PluginTriggerStepFields
				projectId={projectId}
				kind={kind}
				step={step}
				values={values}
				setField={setField}
				errors={errors}
				readOnly={readOnly}
			/>
		),
	}));
}

/** Review, one section per step: every param by the step it was set in. */
export function pluginReviewSections(
	kind: PluginTriggerKind,
	steps: PluginParamTab[],
	values: Record<string, unknown>,
): ReviewSection[] {
	const params = kind.params as Record<string, Param>;
	return steps
		.map((step) => ({
			title: step.name,
			rows: step.items
				.filter((name) => params[name] && params[name].type !== "hint")
				.map((name) => {
					const param = params[name]!;
					const value =
						values[name] ??
						("default" in param ? (param as { default?: unknown }).default : undefined);
					return {
						label: (param as { label?: string }).label ?? name,
						value: paramReviewValue(param, value),
						mono: param.type === "secret" || param.type === "integration",
					};
				}),
		}))
		.filter((section) => section.rows.length > 0);
}
