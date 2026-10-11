import { Label, TextArea, TextField } from "@fluxify/components";

type Props = {
	value: string;
	onChange: (value: string) => void;
	/** names the call, so several boxes in one dialog stay apart for a screen reader */
	label?: string;
};

/**
 * The reason a person gives when the agent wants to put a version in production
 * (#739). It is saved in the deployment log as the description, and the call is
 * not approved without it.
 */
export function DeployComment({ value, onChange, label = "Why is this going live?" }: Props) {
	return (
		<TextField fullWidth variant="secondary" value={value} onChange={onChange} isRequired>
			<Label>{label}</Label>
			<TextArea rows={2} placeholder="Saved with the deployment, next to your name" />
		</TextField>
	);
}
