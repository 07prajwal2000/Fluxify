import { Description, Input, Label, TextField } from "@fluxify/components";
import { AppConfigSelector } from "./AppConfigSelector";

type Props = {
	name: string;
	label: string;
	hint?: string;
	value: unknown;
	onChange: (value: string) => void;
	isDisabled?: boolean;
};

/** A `string` param of a stored form (trigger params, integration config): plain text, never evaluated per request. */
export function PluginStringField({
	name,
	label,
	hint,
	placeholder,
	value,
	onChange,
	isDisabled,
}: Props & { placeholder?: string }) {
	return (
		<TextField
			fullWidth
			variant="secondary"
			name={name}
			isDisabled={isDisabled}
			value={String(value ?? "")}
			onChange={onChange}
		>
			<Label>{label}</Label>
			<Input placeholder={placeholder} />
			{hint && <Description>{hint}</Description>}
		</TextField>
	);
}

/** An `appconfig` param of a stored form: a text box plus the key picker; a picked key is stored as `cfg:<KEY>`. */
export function PluginAppConfigField({
	projectId,
	label,
	hint,
	value,
	onChange,
	isDisabled,
}: Props & { projectId: string }) {
	return (
		<AppConfigSelector
			projectId={projectId}
			label={label}
			description={hint}
			value={String(value ?? "")}
			onChange={onChange}
			isDisabled={isDisabled}
		/>
	);
}
