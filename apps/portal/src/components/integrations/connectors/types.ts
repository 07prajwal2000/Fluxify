import type { McpOAuthEnv } from "@/services/integrations";

/**
 * What an MCP form needs to connect a server with OAuth. Absent while the integration is
 * not saved yet: Connect only appears once it exists.
 */
export type McpOAuthTarget = {
	integrationId: string;
	env: McpOAuthEnv;
	/** project admins connect; everyone else sees the status */
	canConnect: boolean;
	/** the saved config of this environment already signs in with OAuth */
	saved: boolean;
};

export type ConnectorFormProps = {
	oauth?: McpOAuthTarget;
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
