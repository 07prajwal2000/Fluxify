export type ConnectorFormProps = {
	projectId: string;
	name: string;
	onName: (v: string) => void;
	config: Record<string, unknown> & { [k: string]: unknown };
	hideName?: boolean;
	readOnly?: boolean;
	tools?: { name: string; description: string }[];
	// dot-path setter, e.g. setField("credentials.username", value)
	setField: (path: string, value: unknown) => void;
};
