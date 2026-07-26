export type ConnectorFormProps = {
	projectId: string;
	name: string;
	onName: (v: string) => void;
	config: Record<string, unknown> & { [k: string]: unknown };
	// dot-path setter, e.g. setField("credentials.username", value)
	setField: (path: string, value: unknown) => void;
};
